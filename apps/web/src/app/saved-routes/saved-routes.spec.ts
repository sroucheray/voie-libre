import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import {
  InMemoryRouteStore,
  provideInMemoryRouteStore,
} from '../../testing/in-memory-route-store';
import {
  FakePlannerDriver,
  provideFakePlannerDriver,
} from '../../testing/fake-planner-driver';
import { FakeMap, provideFakeMap } from '../../testing/fake-map';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import { SHARING_ENABLED } from '../sharing/share.service';
import { Planner } from '../planner/planner';
import { ROUTE_DEBOUNCE_MS } from '../planner/route-planner';
import { FILE_DOWNLOADER } from '../export/file-download';
import { RouteStoreError } from '../storage/route-store';

const geometry: [number, number, number][] = [
  [3.087, 45.777, 402],
  [3.15, 45.65, 390],
  [3.249, 45.544, 380],
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('Saved routes', () => {
  let drivers: FakePlannerDriver[];
  let calls: number;
  let respond: () => Response;
  let routeStore: InMemoryRouteStore;
  let downloads: { content: string; fileName: string; mimeType: string }[];
  let downloadFails: boolean;
  let sharingEnabled: boolean;
  let sharingCalls: {
    method: string;
    path: string;
    authorization: string | null;
    body: unknown;
  }[];
  let shareRespond: () => Response;
  let elevationRequests: number;
  let elevationRespond: (count: number) => Response;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    drivers = [];
    calls = 0;
    respond = () =>
      json({
        routes: [
          {
            geometry,
            distanceMeters: 41007,
            ascentMeters: 399,
            durationSeconds: 8674,
          },
        ],
      });
    routeStore = new InMemoryRouteStore();
    downloads = [];
    downloadFails = false;
    sharingCalls = [];
    sharingEnabled = true;
    shareRespond = () => json({ id: 'x', deleteToken: 'secret-token' }, 201);
    elevationRequests = 0;
    elevationRespond = (count) =>
      json({
        elevations: Array.from({ length: count }, (_, i) => 100 + i * 20),
      });
    await TestBed.configureTestingModule({
      imports: [Planner],
      providers: [
        provideTestTransloco(),
        provideFakeMap([] as FakeMap[]),
        provideFakePlannerDriver(drivers),
        provideInMemoryRouteStore(routeStore),
        { provide: SHARING_ENABLED, useFactory: () => sharingEnabled },
        {
          provide: FILE_DOWNLOADER,
          useValue: (content: string, fileName: string, mimeType: string) => {
            if (downloadFails) throw new Error('blocked');
            downloads.push({ content, fileName, mimeType });
          },
        },
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              const path = new URL(request.url).pathname;
              if (path.startsWith('/p/')) {
                const text = await request.clone().text();
                sharingCalls.push({
                  method: request.method,
                  path,
                  authorization: request.headers.get('authorization'),
                  body: text ? JSON.parse(text) : undefined,
                });
                return shareRespond();
              }
              if (path === '/elevation') {
                elevationRequests++;
                const body = await request.clone().json();
                return elevationRespond(body.points.length);
              }
              calls++;
              return respond();
            },
          }),
        },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function render() {
    const fixture = TestBed.createComponent(Planner);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const driver = drivers[0];
    const view = {
      fixture,
      root,
      driver,
      /** Lets pending promises, effects and the debounce finish, then redraws. */
      async settle(ms = 0) {
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(ms);
        TestBed.tick();
        fixture.detectChanges();
      },
      async plan() {
        driver.handlers.onClick([3.087, 45.777]);
        driver.handlers.onClick([3.249, 45.544]);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
      },
      save: () => root.querySelector<HTMLButtonElement>('.save button')!,
      nameInput: () => root.querySelector<HTMLInputElement>('.save input')!,
      items: () => Array.from(root.querySelectorAll('.list li')),
      button: (label: string) =>
        root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!,
      /** Clicks "Open <name>" and answers yes when the route being planned would be replaced. */
      open(label: string) {
        view.button(label).click();
        fixture.detectChanges();
        root.querySelector<HTMLButtonElement>('.confirm-open')?.click();
      },
      confirmButton: (text: string) =>
        Array.from(
          root.querySelectorAll<HTMLButtonElement>('.confirm button'),
        ).find((b) => b.textContent?.trim() === text)!,
      alert: () => root.querySelector('[role="alert"]')?.textContent ?? null,
      text: () => root.textContent!.replace(/\s+/g, ' '),
    };
    return view;
  }

  /** Saves the planned route through the UI and returns the view. */
  async function renderWithSavedRoute() {
    const view = await render();
    await view.plan();
    view.save().click();
    await view.settle();
    return view;
  }

  describe('saving', () => {
    it('is disabled until a route is computed', async () => {
      const view = await render();
      expect(view.save().disabled).toBe(true);
      expect(view.nameInput().disabled).toBe(true);
      view.driver.handlers.onClick([3.087, 45.777]);
      await view.settle();
      expect(view.save().disabled).toBe(true);
      view.driver.handlers.onClick([3.249, 45.544]);
      await view.settle();
      expect(view.save().disabled).toBe(true); // still computing
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(view.save().disabled).toBe(false);
    });

    it('proposes a name and saves the selected route', async () => {
      const view = await render();
      await view.plan();
      expect(view.nameInput().value).toBe('Road, 41 km');
      view.save().click();
      await view.settle();

      const [saved] = [...routeStore.records.values()];
      expect(saved).toMatchObject({
        name: 'Road, 41 km',
        profile: 'road',
        points: [
          [3.087, 45.777],
          [3.249, 45.544],
        ],
        geometry,
        distanceMeters: 41007,
        ascentMeters: 399,
        durationSeconds: 8674,
      });
      expect(view.items()).toHaveLength(1);
      expect(view.items()[0].textContent).toContain('Road, 41 km');
      expect(view.items()[0].textContent).toMatch(/41(\.0)? km/);
      expect(view.items()[0].textContent).toContain('399 m');
      expect(view.items()[0].textContent).toContain(
        new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
          saved.createdAt,
        ),
      );
    });

    it('credits the elevation source: SRTM for a planned route, kept when saved and reopened', async () => {
      const view = await render();
      await view.plan();
      expect(
        view.root.querySelector('.profile .source')?.textContent,
      ).toContain('SRTM');
      view.save().click();
      await view.settle();
      expect((await routeStore.list())[0].elevationSource).toBe('srtm');
      view.driver.handlers.onClick([3.0, 45.0]); // leaves the saved route
      view.open('Open Road, 41 km');
      await view.settle();
      expect(
        view.root.querySelector('.profile .source')?.textContent,
      ).toContain('SRTM');
    });

    it('does not credit an imported track that brings its own elevation', async () => {
      await routeStore.save({
        name: 'From a GPS',
        profile: 'road',
        points: [
          [3, 45],
          [3, 45.01],
        ],
        geometry: [
          [3, 45, 100],
          [3, 45.01, 160],
        ],
        distanceMeters: 1100,
        ascentMeters: 60,
        durationSeconds: 300,
      });
      const view = await render();
      view.open('Open From a GPS');
      await view.settle();
      expect(view.root.querySelector('.profile')).not.toBeNull();
      expect(view.root.querySelector('.profile .source')).toBeNull();
    });

    it('saves under the name the user typed, and falls back to the proposal when blank', async () => {
      const view = await render();
      await view.plan();
      const input = view.nameInput();
      input.value = '  Sunday ride ';
      input.dispatchEvent(new Event('input'));
      view.save().click();
      await view.settle();
      expect([...routeStore.records.values()][0].name).toBe('Sunday ride');

      input.value = '   ';
      input.dispatchEvent(new Event('input'));
      view.save().click();
      await view.settle();
      expect(
        view.items().map((li) => li.querySelector('.name')?.textContent),
      ).toEqual(['Road, 41 km', 'Sunday ride']);
    });

    it('proposes a name in the active language', async () => {
      const view = await render();
      await view.plan();
      TestBed.inject(LanguageService).use('fr');
      await view.settle();
      await view.settle();
      expect(view.nameInput().value).toMatch(/^Route, 41\s?km$/);
    });

    it('lists the most recent route first', async () => {
      const view = await render();
      await view.plan();
      for (const name of ['one', 'two']) {
        view.nameInput().value = name;
        view.nameInput().dispatchEvent(new Event('input'));
        view.save().click();
        await view.settle();
      }
      expect(
        view.items().map((li) => li.querySelector('.name')?.textContent),
      ).toEqual(['two', 'one']);
    });

    it('lists the routes already on the device when it starts', async () => {
      await routeStore.save({
        name: 'Earlier',
        profile: 'trail',
        points: [
          [3, 45],
          [3.1, 45.1],
        ],
        geometry,
        distanceMeters: 1200,
        ascentMeters: 10,
        durationSeconds: 600,
      });
      const view = await render();
      await view.settle();
      expect(view.items()).toHaveLength(1);
      expect(view.items()[0].textContent).toContain('Earlier');
      expect(view.items()[0].textContent).toContain('1.2 km');
    });

    it('shows an empty state', async () => {
      const view = await render();
      expect(view.text()).toContain('No saved routes yet');
    });
  });

  describe('hovering', () => {
    it('shows the route on the map while the pointer is on its row, without moving the view', async () => {
      const view = await renderWithSavedRoute();
      const fitted = view.driver.fitted.length;
      const row = view.items()[0];
      row.dispatchEvent(new MouseEvent('mouseenter'));
      await view.settle();
      expect(view.driver.preview?.length).toBeGreaterThan(1);
      expect(view.driver.fitted).toHaveLength(fitted);
      row.dispatchEvent(new MouseEvent('mouseleave'));
      await view.settle();
      expect(view.driver.preview).toBeNull();
    });
  });

  describe('opening', () => {
    it('opens a route from its name, which is stretched over the whole card', async () => {
      const view = await renderWithSavedRoute();
      (view.root.querySelector('.clear') as HTMLButtonElement).click();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      view.items()[0].querySelector<HTMLButtonElement>('.name.open')?.click();
      await view.settle(5 * ROUTE_DEBOUNCE_MS);
      expect(view.driver.routes).toEqual([geometry]);
    });

    it('asks before replacing a route being planned, and keeps it on cancel', async () => {
      const view = await renderWithSavedRoute();
      view.driver.handlers.onClick([3.0, 45.0]);
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      const points = view.root.querySelectorAll('.points li').length;
      view.items()[0].querySelector<HTMLButtonElement>('.name.open')?.click();
      view.fixture.detectChanges();
      expect(view.text()).toContain('Replace the route being planned');
      const cancel = Array.from(
        view.root.querySelectorAll<HTMLButtonElement>('.confirm button'),
      ).find((b) => b.textContent?.trim() === 'Cancel');
      cancel?.click();
      await view.settle();
      expect(view.text()).not.toContain('Replace the route being planned');
      expect(view.root.querySelectorAll('.points li')).toHaveLength(points);
    });

    it('does not open when a button inside the card is clicked', async () => {
      const view = await renderWithSavedRoute();
      (view.root.querySelector('.clear') as HTMLButtonElement).click();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      view.button('Rename Road, 41 km').click();
      await view.settle();
      expect(view.root.querySelectorAll('.points li')).toHaveLength(0);
    });

    it('hides the share button while sharing is off', async () => {
      sharingEnabled = false;
      const view = await renderWithSavedRoute();
      expect(view.root.querySelector('.share')).toBeNull();
    });

    it('restores the route without calling the API, and shows it on the map', async () => {
      const view = await renderWithSavedRoute();
      expect(calls).toBe(1);
      // A different plan on screen, then back to the saved one.
      (view.root.querySelector('.clear') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      view.driver.handlers.onClick([2, 44]);
      view.driver.handlers.onClick([2.1, 44.1]);
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(calls).toBe(2);

      view.open('Open Road, 41 km');
      await view.settle(5 * ROUTE_DEBOUNCE_MS);
      expect(calls).toBe(2);
      expect(view.driver.markers.map((m) => m.lngLat)).toEqual([
        [3.087, 45.777],
        [3.249, 45.544],
      ]);
      expect(view.driver.routes).toEqual([geometry]);
      expect(view.driver.fitted.at(-1)).toEqual(geometry);
      expect(view.root.querySelector('[role="status"]')).toBeNull();
      expect(view.text()).toContain('Route 1');
      expect(view.alert()).toBeNull();
    });

    it('works with no network at all: the API client is never called and nothing fails', async () => {
      const view = await renderWithSavedRoute();
      (view.root.querySelector('.clear') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      calls = 0;
      respond = () => {
        throw new TypeError('Failed to fetch');
      };

      view.open('Open Road, 41 km');
      await view.settle(5 * ROUTE_DEBOUNCE_MS);

      expect(calls).toBe(0);
      expect(view.alert()).toBeNull();
      expect(view.driver.routes).toEqual([geometry]);
      expect(view.root.querySelectorAll('.points li')).toHaveLength(2);
      expect(view.text()).toMatch(/41(\.0)? km/);
    });

    it('recomputes normally on the first edit after opening', async () => {
      const view = await renderWithSavedRoute();
      (view.root.querySelector('.clear') as HTMLButtonElement).click();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      view.open('Open Road, 41 km');
      await view.settle(5 * ROUTE_DEBOUNCE_MS);
      calls = 0;
      view.driver.handlers.onMovePoint(1, [3.3, 45.5]);
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(calls).toBe(1);
    });

    it('says so when the route was deleted elsewhere, and drops it from the list', async () => {
      const view = await renderWithSavedRoute();
      routeStore.records.clear();
      view.open('Open Road, 41 km');
      await view.settle();
      expect(view.alert()).toContain('no longer exists');
      expect(view.items()).toHaveLength(0);
    });
  });

  describe('exporting', () => {
    it('downloads a GPX built from the stored geometry, with no network call', async () => {
      const view = await renderWithSavedRoute();
      calls = 0;
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(calls).toBe(0);
      expect(downloads).toHaveLength(1);
      expect(downloads[0].fileName).toBe('road-41-km.gpx');
      expect(downloads[0].mimeType).toBe('application/gpx+xml');
      const doc = new DOMParser().parseFromString(
        downloads[0].content,
        'application/xml',
      );
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.querySelector('trk > name')?.textContent).toBe('Road, 41 km');
      expect(
        Array.from(doc.querySelectorAll('trkpt')).map((p) => [
          Number(p.getAttribute('lon')),
          Number(p.getAttribute('lat')),
          Number(p.querySelector('ele')?.textContent),
        ]),
      ).toEqual(geometry);
      expect(view.alert()).toBeNull();
    });

    it('writes the start and the end as waypoints, named in the active language', async () => {
      const view = await renderWithSavedRoute();
      const names = (content: string) =>
        Array.from(
          new DOMParser()
            .parseFromString(content, 'application/xml')
            .querySelectorAll('wpt > name'),
        ).map((n) => n.textContent);

      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(names(downloads[0].content)).toEqual(['Start', 'End']);

      TestBed.inject(LanguageService).use('fr');
      await view.settle();
      await view.settle();
      view.button('Exporter Road, 41 km en GPX').click();
      await view.settle();
      expect(names(downloads[1].content)).toEqual(['Départ', 'Arrivée']);
    });

    it('exports under the new name after a rename', async () => {
      const view = await renderWithSavedRoute();
      const [saved] = [...routeStore.records.values()];
      await routeStore.rename(saved.id, 'Été');
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(downloads[0].fileName).toBe('ete.gpx');
    });

    it('translates a refused download', async () => {
      const view = await renderWithSavedRoute();
      downloadFails = true;
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(view.alert()).toContain('GPX file could not be created');
      TestBed.inject(LanguageService).use('fr');
      await view.settle();
      await view.settle();
      expect(view.alert()).toContain("fichier GPX n'a pas pu être créé");
    });

    it('says so when the route was deleted elsewhere', async () => {
      const view = await renderWithSavedRoute();
      routeStore.records.clear();
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(downloads).toHaveLength(0);
      expect(view.alert()).toContain('no longer exists');
    });
  });

  describe('sharing', () => {
    const shareButton = (view: Awaited<ReturnType<typeof render>>) =>
      view.button('Share Road, 41 km by link');

    async function renderWithSharedRoute() {
      const view = await renderWithSavedRoute();
      shareButton(view).click();
      await view.settle();
      return view;
    }

    it('shares only when the user asks: saving sends nothing to the server', async () => {
      await renderWithSavedRoute();
      expect(sharingCalls).toEqual([]);
    });

    it('puts the route under its own id and keeps the delete token on the device only', async () => {
      const view = await renderWithSavedRoute();
      const [saved] = [...routeStore.records.values()];
      shareButton(view).click();
      await view.settle();

      expect(sharingCalls).toHaveLength(1);
      expect(sharingCalls[0].method).toBe('PUT');
      expect(sharingCalls[0].path).toBe(`/p/${saved.id}`);
      expect(sharingCalls[0].body).toMatchObject({
        name: 'Road, 41 km',
        profile: 'road',
        distanceMeters: 41007,
      });
      expect(routeStore.records.get(saved.id)?.share?.deleteToken).toBe(
        'secret-token',
      );
      expect(view.root.textContent).not.toContain('secret-token');
      expect(
        (view.root.querySelector('.share-link input') as HTMLInputElement)
          .value,
      ).toMatch(new RegExp(`/p/${saved.id}$`));
      expect(view.root.querySelector('.badge')?.textContent).toContain(
        'Shared',
      );
      expect(view.button('Share Road, 41 km by link')).toBeNull();
      expect(view.alert()).toBeNull();
    });

    it('copies the link', async () => {
      const view = await renderWithSharedRoute();
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      (view.root.querySelector('.copy') as HTMLButtonElement).click();
      await view.settle();
      expect(writeText).toHaveBeenCalledWith(
        expect.stringMatching(/\/p\/[a-z2-9]{10}$/),
      );
      expect(view.text()).toContain('Link copied');
      vi.unstubAllGlobals();
    });

    it('stops sharing with the token, then offers to share again', async () => {
      const view = await renderWithSharedRoute();
      sharingCalls.length = 0;
      shareRespond = () => new Response(null, { status: 204 });
      view.button('Stop sharing Road, 41 km').click();
      await view.settle();
      expect(sharingCalls).toHaveLength(1);
      expect(sharingCalls[0].method).toBe('DELETE');
      expect(sharingCalls[0].authorization).toBe('Bearer secret-token');
      expect([...routeStore.records.values()][0].share).toBeUndefined();
      expect(view.root.querySelector('.share-link')).toBeNull();
      expect(shareButton(view)).not.toBeNull();
    });

    it('unshares before deleting a shared route, and says so in the confirmation', async () => {
      const view = await renderWithSharedRoute();
      sharingCalls.length = 0;
      shareRespond = () => new Response(null, { status: 204 });
      view.button('Delete Road, 41 km').click();
      await view.settle();
      expect(view.root.querySelector('.confirm')?.textContent).toContain(
        'stop sharing it',
      );
      view.confirmButton('Delete').click();
      await view.settle();
      expect(sharingCalls.map((c) => c.method)).toEqual(['DELETE']);
      expect(routeStore.records.size).toBe(0);
    });

    it('keeps the route, and its token, when the server cannot be reached to unshare it', async () => {
      const view = await renderWithSharedRoute();
      shareRespond = () => {
        throw new TypeError('Failed to fetch');
      };
      view.button('Delete Road, 41 km').click();
      await view.settle();
      view.confirmButton('Delete').click();
      await view.settle();
      expect(routeStore.records.size).toBe(1);
      expect([...routeStore.records.values()][0].share?.deleteToken).toBe(
        'secret-token',
      );
      expect(view.alert()).toContain('cannot be reached');
    });

    it.each([
      [
        429,
        { statusCode: 429, message: 'Rate limit exceeded' },
        'Too many routes',
        'Trop de parcours',
      ],
      [
        409,
        { code: 'already_exists', message: 'x' },
        'already uses this identifier',
        'utilise déjà cet identifiant',
      ],
      [
        413,
        { code: 'payload_too_large', message: 'x' },
        'too large to share',
        'trop volumineux',
      ],
    ] as const)(
      'translates a %i and keeps the route local',
      async (status, body, english, french) => {
        const view = await renderWithSavedRoute();
        shareRespond = () => json(body, status);
        shareButton(view).click();
        await view.settle();
        expect(view.alert()).toContain(english);
        expect(view.alert()).not.toContain('Rate limit exceeded');
        expect([...routeStore.records.values()][0].share).toBeUndefined();
        expect(view.driver.routes).toHaveLength(1);

        TestBed.inject(LanguageService).use('fr');
        await view.settle();
        await view.settle();
        expect(view.alert()).toContain(french);
      },
    );

    it('reports an unreachable server when sharing', async () => {
      const view = await renderWithSavedRoute();
      shareRespond = () => {
        throw new TypeError('Failed to fetch');
      };
      shareButton(view).click();
      await view.settle();
      expect(view.alert()).toContain('cannot be reached');
    });
  });

  describe('renaming', () => {
    it('renames in place', async () => {
      const view = await renderWithSavedRoute();
      view.button('Rename Road, 41 km').click();
      await view.settle();
      const input = view.root.querySelector<HTMLInputElement>('.rename-input')!;
      expect(input.value).toBe('Road, 41 km');
      input.value = 'Col de la Ventouse';
      (view.root.querySelector('.rename') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      await view.settle();
      expect(view.items()[0].querySelector('.name')?.textContent).toBe(
        'Col de la Ventouse',
      );
      expect([...routeStore.records.values()][0].name).toBe(
        'Col de la Ventouse',
      );
      expect(view.root.querySelector('.rename-input')).toBeNull();
    });

    it('cancels with Escape or the button, without changing anything', async () => {
      const view = await renderWithSavedRoute();
      view.button('Rename Road, 41 km').click();
      await view.settle();
      const input = view.root.querySelector<HTMLInputElement>('.rename-input')!;
      input.value = 'ignored';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await view.settle();
      expect(view.root.querySelector('.rename-input')).toBeNull();
      expect(view.items()[0].querySelector('.name')?.textContent).toBe(
        'Road, 41 km',
      );
    });

    it('refuses an empty name', async () => {
      const view = await renderWithSavedRoute();
      view.button('Rename Road, 41 km').click();
      await view.settle();
      const input = view.root.querySelector<HTMLInputElement>('.rename-input')!;
      input.value = '  ';
      (view.root.querySelector('.rename') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      await view.settle();
      expect([...routeStore.records.values()][0].name).toBe('Road, 41 km');
    });
  });

  describe('deleting', () => {
    it('asks for a confirmation and deletes only after it', async () => {
      const view = await renderWithSavedRoute();
      view.button('Delete Road, 41 km').click();
      await view.settle();
      expect(view.root.querySelector('.confirm')?.textContent).toContain(
        'Delete "Road, 41 km" from this device?',
      );
      expect(routeStore.records.size).toBe(1);

      view.confirmButton('Cancel').click();
      await view.settle();
      expect(view.root.querySelector('.confirm')).toBeNull();
      expect(routeStore.records.size).toBe(1);

      view.button('Delete Road, 41 km').click();
      await view.settle();
      view.confirmButton('Delete').click();
      await view.settle();
      expect(routeStore.records.size).toBe(0);
      expect(view.items()).toHaveLength(0);
      expect(view.text()).toContain('No saved routes yet');
    });

    it('does not remove the route being shown on the map', async () => {
      const view = await renderWithSavedRoute();
      view.button('Delete Road, 41 km').click();
      await view.settle();
      view.confirmButton('Delete').click();
      await view.settle();
      expect(view.driver.routes).toHaveLength(1);
    });
  });

  describe('storage errors', () => {
    it.each([
      [
        'unavailable',
        'Saving is not available in this browser',
        "n'est pas disponible",
      ],
      ['quota', 'storage is full', 'est plein'],
      ['unknown', 'could not be read or written', 'pas pu être lus'],
    ] as const)(
      'translates %s and keeps the planner usable',
      async (code, english, french) => {
        const view = await render();
        await view.plan();
        routeStore.failWith = new RouteStoreError(code);
        view.save().click();
        await view.settle();
        expect(view.alert()).toContain(english);
        // The route is still displayed and the planner still reacts.
        expect(view.driver.routes).toHaveLength(1);
        view.driver.handlers.onMovePoint(1, [3.3, 45.5]);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        expect(calls).toBe(2);

        TestBed.inject(LanguageService).use('fr');
        await view.settle();
        await view.settle();
        expect(view.alert()).toContain(french);
      },
    );

    it('reports an unavailable store when the list cannot be read at startup', async () => {
      routeStore.failWith = new RouteStoreError('unavailable');
      const view = await render();
      await view.settle();
      expect(view.alert()).toContain('Saving is not available');
      // Planning still works.
      await view.plan();
      expect(view.driver.routes).toHaveLength(1);
    });

    it('clears the message once an operation succeeds', async () => {
      routeStore.failWith = new RouteStoreError('quota');
      const view = await render();
      await view.plan();
      view.save().click();
      await view.settle();
      expect(view.alert()).not.toBeNull();
      routeStore.failWith = null;
      view.save().click();
      await view.settle();
      expect(view.alert()).toBeNull();
      expect(view.items()).toHaveLength(1);
    });
  });

  describe('importing a GPX file', () => {
    const gpx = (points: string, name = 'Imported ride') =>
      `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${points}</trkseg></trk></gpx>`;
    const withEle =
      '<trkpt lat="45" lon="3"><ele>100</ele></trkpt><trkpt lat="45.01" lon="3"><ele>160</ele></trkpt>';
    const noEle =
      '<trkpt lat="45" lon="3"></trkpt><trkpt lat="45.01" lon="3"></trkpt>';

    async function importFile(
      view: Awaited<ReturnType<typeof render>>,
      content: string,
      name = 'ride.gpx',
    ) {
      const input = view.root.querySelector<HTMLInputElement>(
        '.import input[type="file"]',
      )!;
      // jsdom has no File.text(): a minimal stand-in is enough for the component.
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ name, text: async () => content }],
      });
      input.dispatchEvent(new Event('change'));
      await view.settle();
    }

    it('saves the file as a route, shows it, and never calls the API', async () => {
      const view = await render();
      calls = 0;
      await importFile(view, gpx(withEle));
      expect(calls).toBe(0);
      expect(view.items()).toHaveLength(1);
      expect(view.items()[0].textContent).toContain('Imported ride');
      const [saved] = await routeStore.list();
      expect(saved.points).toHaveLength(2);
      expect(saved.ascentMeters).toBe(60);
      expect(view.driver.routes).toHaveLength(1);
      expect(view.driver.fitted).toHaveLength(1);
      expect(view.alert()).toBeNull();
      expect(view.root.querySelector('.notice')).toBeNull();
    });

    it('names the route after the file when the track has no name', async () => {
      const view = await render();
      await importFile(view, gpx(withEle, ''), 'Col de la Ventouse.gpx');
      expect((await routeStore.list())[0].name).toBe('Col de la Ventouse');
    });

    it('imports without elevation: tells the user, hides the profile, blocks sharing', async () => {
      const view = await render();
      await importFile(view, gpx(noEle));
      expect(view.root.querySelector('.notice')?.textContent).toContain(
        'no elevation',
      );
      expect((await routeStore.list())[0].ascentMeters).toBeNull();
      expect(view.root.querySelector('vl-elevation-panel .profile')).toBeNull();
      expect(
        view.root.querySelector<HTMLButtonElement>('button.share')!.disabled,
      ).toBe(true);
    });

    it('exports an imported route without elevation with no <ele>', async () => {
      const view = await render();
      await importFile(view, gpx(noEle));
      view.button('Export Imported ride as GPX').click();
      await view.settle();
      expect(downloads[0].content).not.toContain('<ele>');
    });

    it('asks before computing the climb, and does not call the server unless the user agrees', async () => {
      const view = await render();
      await importFile(view, gpx(noEle));
      expect(elevationRequests).toBe(0);
      expect(view.root.querySelector('[role="group"].notice')).not.toBeNull();
      view.root
        .querySelectorAll<HTMLButtonElement>('[role="group"].notice button')[1]
        .click();
      await view.settle();
      expect(view.root.querySelector('[role="group"].notice')).toBeNull();
      expect(elevationRequests).toBe(0);
      expect((await routeStore.list())[0].ascentMeters).toBeNull();
    });

    it('computes the climb on request: stores it, shows the profile, enables sharing', async () => {
      const view = await render();
      await importFile(view, gpx(noEle));
      view.root
        .querySelector<HTMLButtonElement>('.notice .compute-climb')!
        .click();
      await view.settle();
      expect(elevationRequests).toBe(1);
      const [saved] = await routeStore.list();
      expect(saved.ascentMeters).toBe(20);
      expect(saved.elevationSource).toBe('copernicus');
      expect(
        view.root.querySelector('.profile .source')?.textContent,
      ).toContain('Copernicus');
      expect(saved.geometry.map((p) => p[2])).toEqual([100, 120]);
      expect(view.root.querySelector('.notice')).toBeNull();
      expect(
        view.root.querySelector('vl-elevation-panel .profile'),
      ).not.toBeNull();
      expect(
        view.root.querySelector<HTMLButtonElement>('button.share')!.disabled,
      ).toBe(false);
      expect(view.alert()).toBeNull();
    });

    it('offers to compute the climb later from the list', async () => {
      const view = await render();
      await importFile(view, gpx(noEle));
      view.root
        .querySelectorAll<HTMLButtonElement>('[role="group"].notice button')[1]
        .click();
      await view.settle();
      view.root
        .querySelector<HTMLButtonElement>('.list .compute-climb')!
        .click();
      await view.settle();
      expect(elevationRequests).toBe(1);
      expect((await routeStore.list())[0].ascentMeters).toBe(20);
      expect(view.root.querySelector('.list .compute-climb')).toBeNull();
    });

    it('keeps the route unchanged and says why when the terrain data cannot be used', async () => {
      const view = await render();
      await importFile(view, gpx(noEle));
      elevationRespond = () => json({ elevations: [null, null] });
      view.root
        .querySelector<HTMLButtonElement>('.notice .compute-climb')!
        .click();
      await view.settle();
      expect(view.alert()).toBe('The terrain data does not cover this route.');
      expect((await routeStore.list())[0].ascentMeters).toBeNull();
      elevationRespond = () => json({ code: 'unavailable', message: 'x' }, 503);
      view.root
        .querySelector<HTMLButtonElement>('.notice .compute-climb')!
        .click();
      await view.settle();
      expect(view.alert()).toBe(
        'The terrain data could not be read. Try again later.',
      );
    });

    it('translates the errors and saves nothing', async () => {
      const view = await render();
      await importFile(view, 'this is not xml');
      expect(view.alert()).toBe('This is not a valid GPX file.');
      await importFile(
        view,
        '<gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>',
      );
      expect(view.alert()).toBe('This GPX file has no track or route.');
      expect(view.items()).toHaveLength(0);
    });
  });
});
