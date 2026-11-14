import { TestBed } from '@angular/core/testing';
import { PlannerStore } from '../planner/planner-store';
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
import { SHARE_SHEET, type ShareOutcome } from '../sharing/share-sheet';
import { RouteStoreError } from '../storage/route-store';
import { buildBackup, parseBackup } from '../storage/backup';

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
  let downloads: {
    /** The text of the file; empty for a binary one, whose bytes are in `bytes`. */
    content: string;
    bytes?: Uint8Array;
    fileName: string;
    mimeType: string;
  }[];
  let downloadFails: boolean;
  let sheetCanShareFile: boolean;
  let sheetOutcome: ShareOutcome;
  let sheetFiles: { name: string; type: string; title?: string }[];
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
            surfaces: 'pu',
          },
        ],
      });
    routeStore = new InMemoryRouteStore();
    downloads = [];
    downloadFails = false;
    sheetCanShareFile = true;
    sheetOutcome = 'shared';
    sheetFiles = [];
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
          provide: SHARE_SHEET,
          useFactory: () => ({
            canShareUrl: () => false,
            canShareFile: () => sheetCanShareFile,
            shareUrl: async () => 'failed',
            shareFile: async (file: File, title?: string) => {
              sheetFiles.push({ name: file.name, type: file.type, title });
              return sheetOutcome;
            },
          }),
        },
        {
          provide: FILE_DOWNLOADER,
          useValue: (
            content: string | Uint8Array,
            fileName: string,
            mimeType: string,
          ) => {
            if (downloadFails) throw new Error('blocked');
            downloads.push(
              typeof content === 'string'
                ? { content, fileName, mimeType }
                : { content: '', bytes: content, fileName, mimeType },
            );
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
      /** Changes the route being planned (the alternatives asked for), so that it can be saved again. */
      async edit() {
        const planner = TestBed.inject(PlannerStore);
        planner.setAlternatives(planner.alternatives() === 1 ? 2 : 1);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
      },
      save: () => root.querySelector<HTMLButtonElement>('.save button')!,
      nameInput: () =>
        root.querySelector<HTMLTextAreaElement>('.save textarea')!,
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
    it('is offered with the route, once a route is computed', async () => {
      const view = await render();
      // The form sits with the route being planned: nothing to name before there is one.
      expect(view.root.querySelector('.save')).toBeNull();
      view.driver.handlers.onClick([3.087, 45.777]);
      await view.settle();
      expect(view.root.querySelector('.save')).toBeNull();
      view.driver.handlers.onClick([3.249, 45.544]);
      await view.settle();
      expect(view.root.querySelector('.save')).toBeNull(); // still computing
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(view.save().disabled).toBe(false);
      expect(view.nameInput().disabled).toBe(false);
      // In the actions bar of the Route section, not in the list of saved routes.
      expect(
        view.root.querySelector('.panel-footer')?.contains(view.save()),
      ).toBe(true);
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

    it('keeps the surfaces of a route when it is saved, and shows them again when it is opened', async () => {
      const view = await render();
      await view.plan();
      view.save().click();
      await view.settle();
      expect((await routeStore.list())[0].surfaces).toBe('pu');
      view.driver.handlers.onClick([3.0, 45.0]); // leaves the saved route
      view.open('Open Road, 41 km');
      await view.settle();
      expect(TestBed.inject(PlannerStore).routes()[0].surfaces).toBe('pu');
    });

    it('credits the elevation source: SRTM for a planned route, kept when saved and reopened', async () => {
      const view = await render();
      await view.plan();
      // The profile starts folded: open it to read its credit.
      view.root
        .querySelector<HTMLButtonElement>('vl-elevation-panel header button')
        ?.click();
      await view.settle();
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

      // Saved: the form gives way to the confirmation until the route is edited.
      expect(view.root.querySelector('.save')).toBeNull();
      await view.edit();
      const again = view.nameInput();
      again.value = '   ';
      again.dispatchEvent(new Event('input'));
      view.save().click();
      await view.settle();
      expect(
        view.items().map((li) => li.querySelector('.name')?.textContent),
      ).toEqual(['Road, 41 km', 'Sunday ride']);
    });

    it('says "Saved" instead of the form until the route is edited, and shows it in the list', async () => {
      const view = await render();
      await view.plan();
      view.save().click();
      await view.settle();
      const notice = view.root.querySelector('.saved-notice') as HTMLElement;
      expect(notice.textContent).toContain('Saved: Road, 41 km');
      expect(view.root.querySelector('.save')).toBeNull();
      // "Show in Saved" opens the list and lights the route.
      (notice.querySelector('.saved-notice__link') as HTMLElement).click();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.list li.fresh')).not.toBeNull();
      // Editing the route brings the form back (the actions bar shows with the Route section).
      await view.edit();
      view.root.querySelector<HTMLButtonElement>('[role="tab"]')?.click();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.saved-notice')).toBeNull();
      expect(view.root.querySelector('.save')).not.toBeNull();
    });

    it('keeps a name on one line: a line break becomes a space, Enter saves', async () => {
      const view = await render();
      await view.plan();
      const input = view.nameInput();
      input.value = 'Col de la\nCroix-Régis';
      input.dispatchEvent(new Event('input'));
      expect(input.value).toBe('Col de la Croix-Régis');
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(enter);
      await view.settle();
      expect(enter.defaultPrevented).toBe(true);
      expect([...routeStore.records.values()][0].name).toBe(
        'Col de la Croix-Régis',
      );
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
        await view.edit();
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

    describe('opening a route when the one on screen is not unsaved work', () => {
      /** Two saved routes: the first (older, at the end of the list) and the second, on screen. */
      async function renderWithTwoSavedRoutes() {
        const view = await renderWithSavedRoute();
        (view.root.querySelector('.clear') as HTMLButtonElement).click();
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        view.driver.handlers.onClick([2, 44]);
        view.driver.handlers.onClick([2.1, 44.1]);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        view.save().click();
        await view.settle();
        expect(view.items()).toHaveLength(2);
        return view;
      }
      const open = (
        view: { items: () => Element[]; fixture: { detectChanges(): void } },
        at: number,
      ) => {
        view
          .items()
          [at].querySelector<HTMLButtonElement>('.name.open')
          ?.click();
        view.fixture.detectChanges();
      };
      const asks = (view: { text: () => string }) =>
        view.text().includes('Replace the route being planned');

      it('opens at once after a route was just saved', async () => {
        const view = await renderWithTwoSavedRoutes();
        open(view, 1);
        await view.settle();
        expect(asks(view)).toBe(false);
      });

      it('opens a second route at once when the first was opened and left alone', async () => {
        const view = await renderWithTwoSavedRoutes();
        open(view, 1);
        await view.settle();
        open(view, 0);
        await view.settle();
        expect(asks(view)).toBe(false);
        open(view, 1);
        await view.settle();
        expect(asks(view)).toBe(false);
      });

      it('asks once the opened route was changed', async () => {
        const view = await renderWithTwoSavedRoutes();
        open(view, 1);
        await view.settle();
        view.driver.handlers.onClick([3.0, 45.0]);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        open(view, 0);
        expect(asks(view)).toBe(true);
      });

      it('does not ask when the change was undone', async () => {
        const view = await renderWithTwoSavedRoutes();
        open(view, 1);
        await view.settle();
        view.driver.handlers.onClick([3.0, 45.0]);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        TestBed.inject(PlannerStore).undo();
        await view.settle();
        open(view, 0);
        expect(asks(view)).toBe(false);
      });

      it('asks for a route planned and not saved', async () => {
        const view = await renderWithSavedRoute();
        (view.root.querySelector('.clear') as HTMLButtonElement).click();
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        view.driver.handlers.onClick([2, 44]);
        view.driver.handlers.onClick([2.1, 44.1]);
        await view.settle(ROUTE_DEBOUNCE_MS + 10);
        open(view, 0);
        expect(asks(view)).toBe(true);
      });
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
      // Nothing is being computed (the profile has a status line of its own).
      expect(
        view.root.querySelector(
          '[role="status"]:not(.stretch):not(.saved-notice):not(.badge-host)',
        ),
      ).toBeNull();
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
      // The start and the end are in their fields, with coordinates: no address is looked up.
      expect(view.root.querySelectorAll('vl-place-field input')).toHaveLength(
        2,
      );
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

  describe('laps of a loop', () => {
    const loop = {
      name: 'Loop',
      profile: 'road' as const,
      points: [
        [3.087, 45.777],
        [3.15, 45.65],
        [3.087, 45.777],
      ] as [number, number][],
      geometry: [geometry[0], geometry[1], geometry[0]],
      distanceMeters: 10_000,
      ascentMeters: 300,
      durationSeconds: 1800,
    };
    const lapsInput = (view: Awaited<ReturnType<typeof render>>) =>
      view.root.querySelector<HTMLInputElement>('.export-formats .laps input');

    async function setLaps(
      view: Awaited<ReturnType<typeof render>>,
      value: string,
    ) {
      const input = lapsInput(view);
      if (!input) throw new Error('No laps input');
      input.value = value;
      input.dispatchEvent(new Event('change'));
      await view.settle();
    }

    it('offers a number of laps for a loop and not for another route', async () => {
      await routeStore.save(loop);
      await routeStore.save({
        ...loop,
        name: 'Line',
        points: loop.points.slice(0, 2),
      });
      const view = await render();
      await view.settle();
      view.button('Export Loop').click();
      await view.settle();
      expect(lapsInput(view)).not.toBeNull();
      expect(lapsInput(view)?.value).toBe('1');
      view.button('Export Line').click();
      await view.settle();
      expect(lapsInput(view)).toBeNull();
    });

    it('keeps the number of laps with the route and shows the total', async () => {
      const saved = await routeStore.save(loop);
      const view = await render();
      await view.settle();
      expect(view.text()).not.toContain('laps');
      view.button('Export Loop').click();
      await view.settle();
      await setLaps(view, '3');
      expect((await routeStore.get(saved.id))?.laps).toBe(3);
      expect(view.root.querySelector('.laps-total')?.textContent).toMatch(
        /3 laps: .*30.*900/,
      );
      expect(view.root.querySelector('.laps-meta')?.textContent).toMatch(
        /3 laps/,
      );
      // Back to one lap: nothing is kept, nothing is said.
      await setLaps(view, '1');
      expect('laps' in ((await routeStore.get(saved.id)) ?? {})).toBe(false);
      expect(view.root.querySelector('.laps-meta')).toBeNull();
    });

    it('holds a number of laps between 1 and the maximum', async () => {
      const saved = await routeStore.save(loop);
      const view = await render();
      await view.settle();
      view.button('Export Loop').click();
      await view.settle();
      await setLaps(view, '999');
      expect((await routeStore.get(saved.id))?.laps).toBe(20);
      expect(lapsInput(view)?.value).toBe('20');
      await setLaps(view, 'abc');
      expect('laps' in ((await routeStore.get(saved.id)) ?? {})).toBe(false);
    });

    it('exports every lap in the GPX track', async () => {
      const saved = await routeStore.save(loop);
      await routeStore.setLaps(saved.id, 3);
      const view = await render();
      await view.settle();
      view.button('Export Loop').click();
      await view.settle();
      view.button('Export Loop as GPX').click();
      await view.settle();
      const doc = new DOMParser().parseFromString(
        downloads[0].content,
        'application/xml',
      );
      // Three vertices a lap, the place where a lap ends and the next starts written once.
      expect(doc.querySelectorAll('trkpt')).toHaveLength(3 + 2 + 2);
      // The waypoints are the route's own, once.
      expect(doc.querySelectorAll('wpt')).toHaveLength(3);
    });

    it('exports one lap of a route that is no loop whatever number was kept', async () => {
      const saved = await routeStore.save({
        ...loop,
        name: 'Line',
        points: loop.points.slice(0, 2),
      });
      await routeStore.setLaps(saved.id, 5);
      const view = await render();
      await view.settle();
      view.button('Export Line').click();
      await view.settle();
      view.button('Export Line as GPX').click();
      await view.settle();
      const doc = new DOMParser().parseFromString(
        downloads[0].content,
        'application/xml',
      );
      expect(doc.querySelectorAll('trkpt')).toHaveLength(3);
    });
  });

  describe('exporting', () => {
    it('downloads a GPX built from the stored geometry, with no network call', async () => {
      const view = await renderWithSavedRoute();
      calls = 0;
      view.button('Export Road, 41 km').click();
      await view.settle();
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

    it('hands the GPX to the share sheet instead of downloading it', async () => {
      const view = await renderWithSavedRoute();
      view.button('Export Road, 41 km').click();
      await view.settle();
      view.button('Share Road, 41 km as a GPX file').click();
      await view.settle();
      expect(sheetFiles).toEqual([
        {
          name: 'road-41-km.gpx',
          type: 'application/gpx+xml',
          title: 'Road, 41 km',
        },
      ]);
      expect(downloads).toEqual([]);
      expect(view.alert()).toBeNull();
    });

    it('says so when the share sheet fails, and stays quiet when it is closed', async () => {
      const view = await renderWithSavedRoute();
      sheetOutcome = 'cancelled';
      view.button('Export Road, 41 km').click();
      await view.settle();
      view.button('Share Road, 41 km as a GPX file').click();
      await view.settle();
      expect(view.alert()).toBeNull();
      sheetOutcome = 'failed';
      view.button('Export Road, 41 km').click();
      await view.settle();
      view.button('Share Road, 41 km as a GPX file').click();
      await view.settle();
      expect(view.alert()).not.toBeNull();
    });

    it('offers no sharing of the GPX where the browser cannot', async () => {
      sheetCanShareFile = false;
      const view = await renderWithSavedRoute();
      view.button('Export Road, 41 km').click();
      await view.settle();
      expect(view.root.querySelector('.share-gpx')).toBeNull();
    });

    it('writes the start and the end as waypoints, named in the active language', async () => {
      const view = await renderWithSavedRoute();
      const names = (content: string) =>
        Array.from(
          new DOMParser()
            .parseFromString(content, 'application/xml')
            .querySelectorAll('wpt > name'),
        ).map((n) => n.textContent);

      view.button('Export Road, 41 km').click();
      await view.settle();
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(names(downloads[0].content)).toEqual(['Start', 'End']);

      TestBed.inject(LanguageService).use('fr');
      await view.settle();
      await view.settle();
      view.button('Exporter Road, 41 km').click();
      await view.settle();
      view.button('Exporter Road, 41 km en GPX').click();
      await view.settle();
      expect(names(downloads[1].content)).toEqual(['Départ', 'Arrivée']);
    });

    it('exports under the new name after a rename', async () => {
      const view = await renderWithSavedRoute();
      const [saved] = [...routeStore.records.values()];
      await routeStore.rename(saved.id, 'Été');
      view.button('Export Road, 41 km').click();
      await view.settle();
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(downloads[0].fileName).toBe('ete.gpx');
    });

    it('offers the formats under the route and downloads a FIT course', async () => {
      const view = await renderWithSavedRoute();
      calls = 0;
      const toggle = view.button('Export Road, 41 km');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click();
      await view.settle();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      view.button('Export Road, 41 km as FIT').click();
      await view.settle();
      expect(calls).toBe(0);
      expect(downloads).toHaveLength(1);
      expect(downloads[0].fileName).toBe('road-41-km.fit');
      expect(downloads[0].mimeType).toBe('application/vnd.ant.fit');
      const bytes = downloads[0].bytes as Uint8Array;
      expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('.FIT');
      // The choice closes once a format is picked.
      expect(view.root.querySelector('.export-formats')).toBeNull();
      expect(view.alert()).toBeNull();
    });

    it('closes the choice of a format without exporting', async () => {
      const view = await renderWithSavedRoute();
      view.button('Export Road, 41 km').click();
      await view.settle();
      view.confirmButton('Cancel').click();
      await view.settle();
      expect(view.root.querySelector('.export-formats')).toBeNull();
      expect(downloads).toHaveLength(0);
    });

    it('translates a refused download', async () => {
      const view = await renderWithSavedRoute();
      downloadFails = true;
      view.button('Export Road, 41 km').click();
      await view.settle();
      view.button('Export Road, 41 km as GPX').click();
      await view.settle();
      expect(view.alert()).toContain('The file could not be created');
      TestBed.inject(LanguageService).use('fr');
      await view.settle();
      await view.settle();
      expect(view.alert()).toContain("Le fichier n'a pas pu être créé");
    });

    it('says so when the route was deleted elsewhere', async () => {
      const view = await renderWithSavedRoute();
      routeStore.records.clear();
      view.button('Export Road, 41 km').click();
      await view.settle();
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
      const input =
        view.root.querySelector<HTMLTextAreaElement>('.rename-input')!;
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
      const input =
        view.root.querySelector<HTMLTextAreaElement>('.rename-input')!;
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
      const input =
        view.root.querySelector<HTMLTextAreaElement>('.rename-input')!;
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

  describe('the backup file', () => {
    async function importBackupText(
      view: Awaited<ReturnType<typeof render>>,
      content: string,
    ) {
      const input = view.root.querySelector<HTMLInputElement>(
        '.backup input[type="file"]',
      )!;
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [
          {
            name: 'routes.json',
            size: content.length,
            text: async () => content,
          },
        ],
      });
      input.dispatchEvent(new Event('change'));
      await view.settle();
    }

    const other = () => ({
      schemaVersion: 1,
      id: 'zzzzzzzzzz',
      name: 'Another ride',
      profile: 'road' as const,
      points: [
        [2, 46],
        [2.2, 46.1],
      ] as [number, number][],
      geometry: [
        [2, 46, 300],
        [2.2, 46.1, 310],
      ] as [number, number, number][],
      distanceMeters: 20000,
      ascentMeters: 80,
      durationSeconds: 3000,
      createdAt: 1,
      updatedAt: 1,
    });

    it('exports every route in one file built on the device, without the delete token', async () => {
      const view = await renderWithSavedRoute();
      const [saved] = await routeStore.list();
      await routeStore.setShare(saved.id, {
        deleteToken: 'secret-token',
        sharedAt: 5,
      });
      calls = 0;
      view.root.querySelector<HTMLButtonElement>('.backup-export')!.click();
      await view.settle();
      expect(calls).toBe(0);
      expect(downloads).toHaveLength(1);
      expect(downloads[0].fileName).toMatch(
        /^voie-libre-routes-\d{4}-\d{2}-\d{2}\.json$/,
      );
      expect(downloads[0].mimeType).toBe('application/json');
      expect(downloads[0].content).not.toContain('secret-token');
      const result = parseBackup(downloads[0].content);
      expect(result.ok && result.routes).toHaveLength(1);
    });

    it('has nothing to export with no route', async () => {
      const view = await render();
      expect(
        view.root.querySelector<HTMLButtonElement>('.backup-export')!.disabled,
      ).toBe(true);
    });

    it('imports the routes that are not there yet, and says how many', async () => {
      const view = await renderWithSavedRoute();
      await importBackupText(view, buildBackup([other()], new Date()));
      expect(await routeStore.list()).toHaveLength(2);
      expect(view.items()).toHaveLength(2);
      expect(view.root.querySelector('.notice')?.textContent).toContain(
        '1 route(s) added',
      );
      expect(view.alert()).toBeNull();
    });

    it('skips a route already on the device', async () => {
      const view = await render();
      const text = buildBackup([other()], new Date());
      await importBackupText(view, text);
      await importBackupText(view, text);
      expect(await routeStore.list()).toHaveLength(1);
      expect(view.root.querySelector('.notice')?.textContent).toContain(
        'Nothing new',
      );
    });

    it('keeps the laps of a loop', async () => {
      const view = await render();
      const loop = {
        ...other(),
        points: [
          [2, 46],
          [2, 46],
        ] as [number, number][],
        loop: { mode: 'distance' as const, distanceMeters: 30000 },
        laps: 3,
      };
      await importBackupText(view, buildBackup([loop], new Date()));
      expect((await routeStore.list())[0].laps).toBe(3);
    });

    it.each([
      ['hello', 'not a Voie Libre routes file'],
      [
        JSON.stringify({ kind: 'voie-libre-routes', version: 99, routes: [] }),
        'newer version',
      ],
      [
        JSON.stringify({
          kind: 'voie-libre-routes',
          version: 1,
          routes: [{ name: 'x' }],
        }),
        'damaged',
      ],
    ])('refuses a file that is not valid: %s', async (content, message) => {
      const view = await render();
      await importBackupText(view, content);
      expect(view.alert()).toContain(message);
      expect(await routeStore.list()).toHaveLength(0);
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
      view.button('Export Imported ride').click();
      await view.settle();
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
      // The profile starts folded: open it to read its credit.
      view.root
        .querySelector<HTMLButtonElement>('vl-elevation-panel header button')
        ?.click();
      await view.settle();
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
  describe('the name proposed for a route', () => {
    const START: [number, number] = [3.087, 45.777];
    const END: [number, number] = [3.249, 45.544];
    const store = () => TestBed.inject(PlannerStore);
    const type = (
      view: { nameInput: () => HTMLTextAreaElement },
      text: string,
    ) => {
      const input = view.nameInput();
      input.value = text;
      input.dispatchEvent(new Event('input'));
    };

    it('falls back on the profile and the length while the places are not known', async () => {
      const view = await render();
      await view.plan();
      expect(view.nameInput().value).toBe('Road, 41 km');
    });

    it('proposes the places once they are known, and follows them', async () => {
      const view = await render();
      await view.plan();
      store().setLabel(
        START,
        '10 Rue Abbé Girard, Clermont-Ferrand',
        'Clermont-Ferrand',
      );
      store().setLabel(END, '7 Rue de la Berbiziale, Issoire', 'Issoire');
      await view.settle(0);
      expect(view.nameInput().value).toBe('Clermont-Ferrand → Issoire');
      // The route is reversed: the names follow.
      store().reverse();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(view.nameInput().value).toBe('Issoire → Clermont-Ferrand');
    });

    it('stops following the route once the user typed a name', async () => {
      const view = await render();
      await view.plan();
      store().setLabel(START, 'a', 'Clermont-Ferrand');
      store().setLabel(END, 'b', 'Issoire');
      await view.settle(0);
      type(view, 'Sortie du dimanche');
      store().reverse();
      store().setLabel(END, 'c', 'Brioude');
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(view.nameInput().value).toBe('Sortie du dimanche');
      view.save().click();
      await view.settle();
      expect((await routeStore.list())[0].name).toBe('Sortie du dimanche');
    });

    it('saves the proposal when the field was emptied by hand', async () => {
      const view = await render();
      await view.plan();
      store().setLabel(START, 'a', 'Clermont-Ferrand');
      store().setLabel(END, 'b', 'Issoire');
      await view.settle(0);
      type(view, '');
      view.save().click();
      await view.settle();
      expect((await routeStore.list())[0].name).toBe(
        'Clermont-Ferrand → Issoire',
      );
    });

    it('proposes a name again when the route is cleared and another one is planned', async () => {
      const view = await render();
      await view.plan();
      store().setLabel(START, 'a', 'Clermont-Ferrand');
      store().setLabel(END, 'b', 'Issoire');
      type(view, 'Sortie du dimanche');
      store().clear();
      await view.settle(0);
      await view.plan();
      expect(view.nameInput().value).toBe('Clermont-Ferrand → Issoire');
    });

    it('adds the date when a saved route already has that name, then a number', async () => {
      const view = await render();
      await view.plan();
      store().setLabel(START, 'a', 'Clermont-Ferrand');
      store().setLabel(END, 'b', 'Issoire');
      await view.settle(0);
      view.save().click();
      await view.settle();
      expect((await routeStore.list())[0].name).toBe(
        'Clermont-Ferrand → Issoire',
      );
      // The same trip again, once edited: the form proposes the name with today's date.
      await view.edit();
      await view.settle(0);
      const proposed = view.nameInput().value;
      expect(proposed).toMatch(/^Clermont-Ferrand → Issoire, /);
      view.save().click();
      await view.settle();
      expect((await routeStore.list()).map((r) => r.name).sort()).toEqual(
        ['Clermont-Ferrand → Issoire', proposed].sort(),
      );
    });

    it('names a loop and a trip with stops', async () => {
      const view = await render();
      await view.plan();
      store().setLabel(START, 'a', 'Clermont-Ferrand');
      store().setLabel(END, 'b', 'Issoire');
      store().closeLoop();
      await view.settle(ROUTE_DEBOUNCE_MS + 10);
      expect(view.nameInput().value).toBe('Loop around Clermont-Ferrand');
    });
  });
});
