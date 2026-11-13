import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import {
  FakePlannerDriver,
  provideFakePlannerDriver,
} from '../../testing/fake-planner-driver';
import { FakeMap, provideFakeMap } from '../../testing/fake-map';
import {
  FakeGeolocation,
  provideFakeGeolocation,
} from '../../testing/fake-geolocation';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { provideInMemoryRouteStore } from '../../testing/in-memory-route-store';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import { COMPUTING_DELAY_MS, LIVE_DRAG_INTERVAL_MS, Planner } from './planner';
import { FullscreenMap } from '../core/fullscreen/fullscreen-map';
import { PlannerStore } from './planner-store';
import { WAY_TILES, type Way, type WayTileReader } from '../core/map/way-tiles';
import { ROUTE_DEBOUNCE_MS } from './route-planner';
import { MapLayers } from '../core/map/map-layers';
import { SEARCH_DEBOUNCE_MS } from '../search/place-field';
import { LocationStore } from '../location/location-store';
import { NAME_DEBOUNCE_MS } from '../search/point-namer';

const line = (offset: number) => [
  [3.087, 45.777, 402],
  [3.15 + offset, 45.65, 390],
  [3.249, 45.544, 380],
];

const routes = (count: number) => ({
  routes: Array.from({ length: count }, (_, i) => ({
    geometry: line(i / 100),
    distanceMeters: 41000 + i * 1500,
    ascentMeters: 400 + i * 50,
    durationSeconds: 8600 + i * 300,
  })),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Timers are faked for the whole file: the map and the driver are created asynchronously, fetch
 * is not tracked by whenStable, and the route is debounced.
 */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('Planner', () => {
  let drivers: FakePlannerDriver[];
  /** The reader of the basemap's ways; `null` (no snapping) unless a test sets one. */
  let wayTiles: WayTileReader | null = null;
  let geolocation: FakeGeolocation;
  let requests: {
    points: unknown[];
    profile: string;
    alternatives: number;
    loop?: unknown;
  }[];
  let respond: (count: number) => Response;
  let geocoded: string[];
  let geocode: (url: URL) => Response | Promise<Response>;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    drivers = [];
    requests = [];
    geolocation = new FakeGeolocation();
    respond = () => json(routes(1));
    geocoded = [];
    geocode = (url) =>
      json(
        url.pathname === '/geocode/reverse' ? { place: null } : { places: [] },
      );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/geocode')) {
          geocoded.push(`${url.pathname}${url.search}`);
          const answer = await geocode(url);
          // A request cancelled while it waited gets no answer, like a real fetch.
          if (request.signal.aborted) {
            throw new DOMException('aborted', 'AbortError');
          }
          return answer;
        }
        const body = await request.clone().json();
        requests.push(body);
        return respond(body.alternatives);
      },
    });
    await TestBed.configureTestingModule({
      imports: [Planner],
      providers: [
        provideTestTransloco(),
        provideFakeMap([] as FakeMap[]),
        provideFakePlannerDriver(drivers),
        provideFakeGeolocation(geolocation),
        provideInMemoryRouteStore(),
        { provide: API_CLIENT, useValue: client },
        { provide: WAY_TILES, useValue: () => wayTiles },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  afterEach(() => {
    vi.useRealTimers();
    wayTiles = null;
  });

  async function render() {
    const fixture = TestBed.createComponent(Planner);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const driver = drivers[0];
    return {
      fixture,
      root,
      driver,
      click: (lon: number, lat: number) => {
        driver.handlers.onClick([lon, lat]);
        fixture.detectChanges();
      },
      /** Lets the debounce and the request finish, then redraws. */
      async settle() {
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(ROUTE_DEBOUNCE_MS + 10);
        TestBed.tick();
        fixture.detectChanges();
      },
      text: () => root.textContent!.replace(/\s+/g, ' '),
    };
  }

  describe('a computation that lasts', () => {
    const answer = {
      geometry: [
        [3.087, 45.777, 402],
        [3.249, 45.544, 380],
      ] as [number, number, number][],
      distanceMeters: 1000,
      ascentMeters: 10,
      durationSeconds: 100,
    };
    const advance = async (
      view: Awaited<ReturnType<typeof render>>,
      ms: number,
    ) => {
      await vi.advanceTimersByTimeAsync(ms);
      TestBed.tick();
      view.fixture.detectChanges();
    };

    it('shows a badge and fades the routes once it lasts, and takes both away when it is over', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      store.startLoading();
      await advance(view, COMPUTING_DELAY_MS - 1);
      expect(view.root.querySelector('.badge')).toBeNull();
      expect(view.driver.stale).toBe(false);
      await advance(view, 2);
      expect(view.root.querySelector('.badge')?.textContent).toContain(
        'Computing the route',
      );
      expect(view.driver.stale).toBe(true);
      store.setRoutes([answer]);
      await advance(view, 1);
      expect(view.root.querySelector('.badge')).toBeNull();
      expect(view.driver.stale).toBe(false);
    });

    it('shows nothing for a computation that comes back at once', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      store.startLoading();
      await advance(view, COMPUTING_DELAY_MS / 3);
      store.setRoutes([answer]);
      await advance(view, COMPUTING_DELAY_MS * 2);
      expect(view.root.querySelector('.badge')).toBeNull();
      expect(view.driver.stale).toBe(false);
    });

    it('shows nothing while a point is being dragged: every stretch it asks for is quick', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      store.startDrag();
      store.startLoading();
      await advance(view, COMPUTING_DELAY_MS * 3);
      expect(view.root.querySelector('.badge')).toBeNull();
      expect(view.driver.stale).toBe(false);
      store.cancelDrag();
    });
  });

  it('asks for the start, then for the end', async () => {
    const view = await render();
    expect(view.text()).toContain('Click the map to set the start.');
    view.click(3.087, 45.777);
    expect(view.text()).toContain('Click the map to set the end.');
    view.click(3.249, 45.544);
    expect(view.text()).not.toContain('Click the map to set');
  });

  it('draws a labelled marker for each point, waypoints before the end', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    view.click(3.15, 45.65);
    TestBed.tick();
    expect(
      view.driver.markers.map((m) => [m.role, m.label, m.ariaLabel]),
    ).toEqual([
      ['start', 'A', 'Start'],
      ['waypoint', '1', 'Waypoint 1'],
      ['end', 'B', 'End'],
    ]);
    expect(view.driver.markers[1].lngLat).toEqual([3.15, 45.65]);
  });

  it('changes the help bar with the state of the route', async () => {
    const view = await render();
    const bar = () => view.root.querySelector('.help-bar')?.textContent ?? '';
    expect(bar()).toContain('set the start');
    view.click(3.087, 45.777);
    view.fixture.detectChanges();
    expect(bar()).toContain('set the end');
    view.click(3.249, 45.544);
    view.fixture.detectChanges();
    expect(bar()).toContain('Drag a marker to move it');
    TestBed.inject(PlannerStore).closeLoop();
    view.fixture.detectChanges();
    expect(bar()).toContain('Loop closed');
    expect(
      view.root.querySelector('.help-bar')?.getAttribute('aria-live'),
    ).toBe('polite');
  });

  describe('route panel', () => {
    const order = (root: HTMLElement, selectors: string[]) =>
      selectors.map((selector) => {
        const element = root.querySelector(selector);
        return element
          ? Array.from(root.querySelectorAll('*')).indexOf(element)
          : -1;
      });

    it('puts the places, then the loop, then the result, then the actions, in that order', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      view.fixture.detectChanges();
      const positions = order(view.root, [
        'vl-profile-select',
        '.route-fields',
        '.loop',
        '.result',
        '.panel-footer',
      ]);
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('keeps the options about the result in its header', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      view.fixture.detectChanges();
      const header = view.root.querySelector('.result__header') as HTMLElement;
      expect(header.querySelector('.alternatives select')).not.toBeNull();
      expect(header.textContent).toContain('Route');
    });

    it('keeps save and clear all in a bar outside the scrolling part', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      view.fixture.detectChanges();
      const footer = view.root.querySelector('.panel-footer') as HTMLElement;
      const scrolling = view.root.querySelector('.tab-route') as HTMLElement;
      expect(scrolling.contains(footer)).toBe(false);
      expect(footer.querySelector('.clear')).not.toBeNull();
      expect(footer.querySelector('form.save, .saved-notice')).not.toBeNull();
    });

    it('folds the loop settings under a title that says the length', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      view.root
        .querySelector<HTMLButtonElement>('.loop-dialog .loop-choice')
        ?.click();
      view.fixture.detectChanges();
      await view.settle();
      const details = view.root.querySelector(
        'details.loop-settings',
      ) as HTMLDetailsElement | null;
      expect(details).not.toBeNull();
      expect(details?.open).toBe(false);
      expect(details?.querySelector('summary')?.textContent).toContain('km');
    });
  });

  describe('phone sheet', () => {
    const panel = (view: Awaited<ReturnType<typeof render>>) =>
      view.root.querySelector('.panel') as HTMLElement;

    it('goes peek, half, full and back to peek with taps on the handle', async () => {
      const view = await render();
      const handle = view.root.querySelector(
        '.sheet-handle',
      ) as HTMLButtonElement;
      expect(panel(view).classList).toContain('panel--peek');
      const states = ['half', 'full', 'peek'];
      for (const state of states) {
        handle.click();
        view.fixture.detectChanges();
        expect(panel(view).classList).toContain(`panel--${state}`);
      }
    });

    it('moves with the arrow keys of the handle, never past the ends', async () => {
      const view = await render();
      const handle = view.root.querySelector(
        '.sheet-handle',
      ) as HTMLButtonElement;
      const press = (key: string) => {
        handle.dispatchEvent(new KeyboardEvent('keydown', { key }));
        view.fixture.detectChanges();
      };
      press('ArrowDown');
      expect(panel(view).classList).toContain('panel--peek');
      press('ArrowUp');
      press('ArrowUp');
      press('ArrowUp');
      expect(panel(view).classList).toContain('panel--full');
      press('ArrowDown');
      expect(panel(view).classList).toContain('panel--half');
    });

    it('offers the panel in its summary line, then what the route comes to', async () => {
      const view = await render();
      const summary = () =>
        view.root.querySelector('.sheet-summary')?.textContent?.trim();
      expect(summary()).toBe('Open to search a place or pick a profile.');
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      view.fixture.detectChanges();
      expect(summary()).toMatch(/km/);
      view.root.querySelector<HTMLButtonElement>('.sheet-summary')?.click();
      view.fixture.detectChanges();
      expect(panel(view).classList).toContain('panel--half');
      expect(view.root.querySelector('.sheet-summary')).toBeNull();
    });

    it('goes back down to peek when the map is touched at half, and stays at full', async () => {
      const view = await render();
      const handle = view.root.querySelector(
        '.sheet-handle',
      ) as HTMLButtonElement;
      const map = view.root.querySelector('vl-map-view') as HTMLElement;
      handle.click();
      view.fixture.detectChanges();
      map.dispatchEvent(new Event('pointerdown'));
      view.fixture.detectChanges();
      expect(panel(view).classList).toContain('panel--peek');
      handle.click();
      handle.click();
      view.fixture.detectChanges();
      map.dispatchEvent(new Event('pointerdown'));
      view.fixture.detectChanges();
      expect(panel(view).classList).toContain('panel--full');
    });

    it('hides the sheet and takes the page chrome away in full screen, and gives it back', async () => {
      const view = await render();
      const button = view.root.querySelector(
        '.map-history__fullscreen',
      ) as HTMLButtonElement;
      button.click();
      view.fixture.detectChanges();
      expect(panel(view).classList).toContain('panel--gone');
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('aria-label')).toBe('Leave full screen');
      expect(TestBed.inject(FullscreenMap).active()).toBe(true);
      button.click();
      view.fixture.detectChanges();
      expect(panel(view).classList).not.toContain('panel--gone');
      expect(button.getAttribute('aria-label')).toBe('Full screen map');
    });

    it('rises to half when a tab is chosen', async () => {
      const view = await render();
      view.root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
      view.fixture.detectChanges();
      expect(panel(view).classList).toContain('panel--half');
    });
  });

  describe('loop', () => {
    it('offers to close the loop on the start marker, even before there is an end', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      TestBed.tick();
      expect(view.driver.markers[0].closable).toBe('Close the loop');
      view.click(3.249, 45.544);
      TestBed.tick();
      expect(view.driver.markers[0].closable).toBe('Close the loop');
      expect(view.driver.markers[1].closable).toBeUndefined();
    });

    it('says "Make a loop" with just a start and "Close the loop" with a route, with a hint for each', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      const button = () =>
        view.root.querySelector('.loop') as HTMLButtonElement;
      const title = () =>
        view.root.querySelector('.loop__title')?.textContent?.trim();
      const hint = () =>
        view.root.querySelector('#loop-hint')?.textContent?.trim();
      // The title and the hint are inside the one button: they cannot be taken for two things.
      expect(title()).toBe('Make a loop');
      expect(button().contains(view.root.querySelector('#loop-hint'))).toBe(
        true,
      );
      expect(button().getAttribute('aria-labelledby')).toBe('loop-title');
      expect(hint()).toBe('Draw a loop of a set length from the start.');
      // The hint is the button's description, for screen readers.
      expect(button().getAttribute('aria-describedby')).toBe('loop-hint');
      // The hint stays inside the loop card; "Clear all" is not part of it any more.
      expect(button().contains(view.root.querySelector('#loop-hint'))).toBe(
        true,
      );
      expect(button().querySelector('.clear')).toBeNull();
      button().click();
      view.fixture.detectChanges();
      expect(
        view.root.querySelector('#loop-dialog-title')?.textContent?.trim(),
      ).toBe('Make a loop');
      view.root.querySelector<HTMLButtonElement>('.loop-cancel')?.click();
      view.fixture.detectChanges();

      view.click(3.249, 45.544);
      view.fixture.detectChanges();
      expect(title()).toBe('Close the loop');
      expect(hint()).toBe(
        'Return to the start along your stops, or by another way.',
      );
      button().click();
      view.fixture.detectChanges();
      expect(
        view.root.querySelector('#loop-dialog-title')?.textContent?.trim(),
      ).toBe('Close the loop');
    });

    it('speaks French too', async () => {
      TestBed.inject(LanguageService).use('fr');
      const view = await render();
      await view.settle();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      expect(view.root.querySelector('.loop__title')?.textContent?.trim()).toBe(
        'Faire une boucle',
      );
      view.click(3.249, 45.544);
      view.fixture.detectChanges();
      expect(view.root.querySelector('.loop__title')?.textContent?.trim()).toBe(
        'Boucler le parcours',
      );
    });

    it('goes straight to the length and climb when there is just a start', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      expect(
        view.root.querySelectorAll('.loop-dialog .loop-length input'),
      ).toHaveLength(2);
      // The only button left besides "cancel" draws the loop.
      expect(view.root.querySelectorAll('.loop-choice')).toHaveLength(1);
    });

    it('draws a loop by duration with the speed of the profile', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      const duration = view.root.querySelector<HTMLInputElement>(
        '.loop-by input[value="duration"]',
      );
      duration?.click();
      view.fixture.detectChanges();
      const [minutes] = Array.from(
        view.root.querySelectorAll<HTMLInputElement>(
          '.loop-dialog .loop-length input',
        ),
      );
      minutes.value = '60';
      minutes.dispatchEvent(new Event('input'));
      view.fixture.detectChanges();
      expect(view.root.querySelector('.loop-estimate')?.textContent).toContain(
        '22.0 km',
      );
      view.root.querySelector<HTMLButtonElement>('.loop-choice')?.click();
      expect(TestBed.inject(PlannerStore).loop()).toMatchObject({
        mode: 'distance',
        distanceMeters: 22_000,
      });
    });

    it('asks the number of alternatives in the loop dialog, shared with the panel', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      const select = view.root.querySelector<HTMLSelectElement>(
        '.loop-dialog .loop-alternatives',
      ) as HTMLSelectElement;
      select.value = '3';
      select.dispatchEvent(new Event('change'));
      expect(TestBed.inject(PlannerStore).alternatives()).toBe(3);
    });

    it('goes straight to the length when the start marker is clicked', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.driver.handlers.onCloseLoop();
      view.fixture.detectChanges();
      expect(
        view.root.querySelectorAll('.loop-dialog .loop-length input'),
      ).toHaveLength(2);
    });

    it('asks how to close the loop, with three choices', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      view.fixture.detectChanges();
      expect(view.root.querySelector('.loop-dialog')).toBeNull();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      const choices = Array.from(
        view.root.querySelectorAll<HTMLButtonElement>('.loop-choice'),
      );
      expect(choices.map((c) => c.disabled)).toEqual([false, false, false]);
      choices[0].click();
      view.fixture.detectChanges();
      expect(TestBed.inject(PlannerStore).isLoop()).toBe(true);
      expect(view.root.querySelector('.loop-dialog')).toBeNull();
      expect(view.root.querySelector('.loop')).toBeNull();
    });

    it('closes the loop asking for another way back and sends the mode to the API', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      view.root.querySelectorAll<HTMLButtonElement>('.loop-choice')[1].click();
      view.fixture.detectChanges();
      await view.settle();
      const last = requests[requests.length - 1];
      expect(last.points).toHaveLength(3);
      expect(last.loop).toEqual({ mode: 'avoid_outbound' });
    });

    it('draws a loop by distance from the start only, in kilometres', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      view.root.querySelectorAll<HTMLButtonElement>('.loop-choice')[2].click();
      view.fixture.detectChanges();
      const input = view.root.querySelector(
        '.loop-dialog .loop-length input',
      ) as HTMLInputElement;
      expect(input.value).toBe('30');
      input.value = '45';
      input.dispatchEvent(new Event('input'));
      view.root
        .querySelector<HTMLButtonElement>('.loop-dialog .loop-choice')
        ?.click();
      view.fixture.detectChanges();
      await view.settle();
      const last = requests[requests.length - 1];
      expect(last.points).toEqual([
        { lon: 3.087, lat: 45.777 },
        { lon: 3.087, lat: 45.777 },
      ]);
      expect(last.loop).toEqual({ mode: 'distance', distanceMeters: 45000 });
      // The length can be changed afterwards, from the panel.
      const field = view.root.querySelector(
        '.panel .loop-length input',
      ) as HTMLInputElement;
      expect(field.value).toBe('45');
      field.value = '20';
      field.dispatchEvent(new Event('change'));
      view.fixture.detectChanges();
      await view.settle();
      expect(requests[requests.length - 1].loop).toEqual({
        mode: 'distance',
        distanceMeters: 20000,
      });
    });

    it('heads a loop by distance the way that was asked', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      const pick = (select: HTMLSelectElement, value: string) => {
        select.value = value;
        select.dispatchEvent(new Event('change'));
        view.fixture.detectChanges();
      };
      const asked = view.root.querySelector(
        '.loop-dialog .loop-direction',
      ) as HTMLSelectElement;
      expect(
        Array.from(asked.options).map((o) => o.textContent?.trim()),
      ).toEqual([
        'Any',
        'North',
        'North-east',
        'East',
        'South-east',
        'South',
        'South-west',
        'West',
        'North-west',
      ]);
      pick(asked, 'ne');
      view.root
        .querySelector<HTMLButtonElement>('.loop-dialog .loop-choice')
        ?.click();
      view.fixture.detectChanges();
      await view.settle();
      expect(requests[requests.length - 1].loop).toEqual({
        mode: 'distance',
        distanceMeters: 30000,
        direction: 'ne',
      });
      // The direction can be changed, or left to the engine, from the panel.
      const panel = () =>
        view.root.querySelector('.panel .loop-direction') as HTMLSelectElement;
      expect(panel().value).toBe('ne');
      pick(panel(), 's');
      await view.settle();
      expect(requests[requests.length - 1].loop).toMatchObject({
        direction: 's',
      });
      pick(panel(), '');
      await view.settle();
      expect(requests[requests.length - 1].loop).toEqual({
        mode: 'distance',
        distanceMeters: 30000,
      });
    });

    it('opens the same dialog from a click on the start marker, and can be cancelled', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      view.driver.handlers.onCloseLoop();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.loop-dialog')).not.toBeNull();
      (view.root.querySelector('.loop-cancel') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.loop-dialog')).toBeNull();
      expect(TestBed.inject(PlannerStore).isLoop()).toBe(false);
    });
  });

  it('inserts a dragged route as a waypoint in the segment it came from', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    view.click(3.15, 45.65);
    await view.settle();
    // The mocked route goes start, waypoint, end: drop one between the waypoint and the end.
    const store = TestBed.inject(PlannerStore);
    const geometry = store.selectedGeometry();
    expect(geometry.length).toBeGreaterThan(1);
    const last = geometry[geometry.length - 1];
    view.driver.handlers.onInsertPoint([last[0], last[1]], [3.3, 45.5]);
    expect(store.points().length).toBe(4);
    expect(store.points()[3]).toEqual([3.249, 45.544]);
    expect(store.points()[2]).toEqual([3.3, 45.5]);
  });

  describe('my position', () => {
    const button = (root: HTMLElement) =>
      root.querySelector<HTMLButtonElement>('.locate__button')!;

    it('shows the position only once the user asks, then hides it', async () => {
      const view = await render();
      expect(geolocation.starts).toBe(0);
      expect(button(view.root).getAttribute('aria-pressed')).toBe('false');

      button(view.root).click();
      view.fixture.detectChanges();
      expect(button(view.root).getAttribute('aria-pressed')).toBe('true');
      expect(
        view.root.querySelector('.locate__message')?.textContent,
      ).toContain('Looking for your position');

      geolocation.emit({ accuracyMeters: 30, heading: 45 });
      TestBed.tick();
      view.fixture.detectChanges();
      expect(view.driver.location).toEqual({
        position: [3.08, 45.78],
        accuracyMeters: 30,
        heading: 45,
      });
      expect(view.root.querySelector('.locate__message')?.textContent).toBe('');

      button(view.root).click();
      view.fixture.detectChanges();
      TestBed.tick();
      expect(view.driver.location).toBeNull();
      expect(geolocation.watching).toBe(false);
    });

    it('explains a refusal and leaves the planner usable', async () => {
      const view = await render();
      button(view.root).click();
      geolocation.fail('denied');
      view.fixture.detectChanges();
      expect(
        view.root.querySelector('.locate__message')?.textContent,
      ).toContain('Location access was refused');
      view.click(3.087, 45.777);
      expect(TestBed.inject(PlannerStore).points().length).toBe(1);
    });

    it('disables the button outside a secure page', async () => {
      geolocation.supported = 'insecure';
      const view = await render();
      expect(button(view.root).disabled).toBe(true);
      expect(button(view.root).title).toContain('secure');
    });

    it('puts the start, a stop and the end on the user from the panel', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      const place = () =>
        view.root.querySelector<HTMLButtonElement>('.place-position');
      expect(place()).toBeNull();

      button(view.root).click();
      geolocation.emit({ position: [3.1, 45.7] });
      view.fixture.detectChanges();
      expect(place()?.textContent).toContain('as the start');
      place()!.click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([[3.1, 45.7]]);

      expect(place()?.textContent).toContain('as the end');
      geolocation.emit({ position: [3.2, 45.6] });
      view.fixture.detectChanges();
      place()!.click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([
        [3.1, 45.7],
        [3.2, 45.6],
      ]);
      expect(place()?.textContent).toContain('as a stop');
    });

    it('offers "My position" in the map menu only with a position', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      const items = () =>
        Array.from(
          view.root.querySelectorAll<HTMLButtonElement>('.map-menu button'),
        );
      view.driver.handlers.onContextMenu([3, 45], { x: 40, y: 60 });
      view.fixture.detectChanges();
      expect(items().some((b) => b.textContent?.includes('my position'))).toBe(
        false,
      );
      view.driver.handlers.onContextMenu([3, 45], { x: 40, y: 60 });

      button(view.root).click();
      geolocation.emit({ position: [3.3, 45.5] });
      view.fixture.detectChanges();
      items()
        .find((b) => b.textContent?.includes('Use my position'))!
        .click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([[3.3, 45.5]]);
      expect(view.root.querySelector('.map-menu')).toBeNull();
    });

    it('stops watching when the planner is destroyed', async () => {
      const view = await render();
      button(view.root).click();
      view.fixture.destroy();
      expect(geolocation.watching).toBe(false);
    });
  });

  describe('touch menu and undo', () => {
    it('places a start, a stop and an end from the map menu', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      const open = (x: number, y: number) => {
        view.driver.handlers.onContextMenu([x, y], { x: 40, y: 60 });
        view.fixture.detectChanges();
      };
      const choose = (label: string) => {
        const items = Array.from(
          view.root.querySelectorAll<HTMLButtonElement>('.map-menu button'),
        );
        items.find((b) => b.textContent?.includes(label))?.click();
        view.fixture.detectChanges();
      };
      open(3, 45);
      expect(view.root.querySelectorAll('.map-menu button').length).toBe(1);
      choose('Set as start');
      open(4, 46);
      choose('Set as end');
      expect(store.points()).toEqual([
        [3, 45],
        [4, 46],
      ]);
      open(3.5, 45.5);
      expect(view.root.querySelectorAll('.map-menu button').length).toBe(3);
      choose('Add a stop here');
      expect(store.points()).toEqual([
        [3, 45],
        [3.5, 45.5],
        [4, 46],
      ]);
      expect(view.root.querySelector('.map-menu')).toBeNull();
    });

    it('offers to undo a removed point for a few seconds', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      view.driver.handlers.onRemovePoint(1);
      view.fixture.detectChanges();
      TestBed.tick();
      expect(view.text()).toContain('Point removed.');
      (
        view.root.querySelector('.undo-toast button') as HTMLButtonElement
      ).click();
      view.fixture.detectChanges();
      expect(store.points().length).toBe(2);
      expect(view.root.querySelector('.undo-toast')).toBeNull();
    });

    it('forgets the removed point after the delay', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      view.click(3.087, 45.777);
      view.driver.handlers.onRemovePoint(0);
      TestBed.tick();
      vi.advanceTimersByTime(6100);
      expect(store.removed()).toBeNull();
    });
  });

  it('shows a ghost that says what the next click creates', async () => {
    const view = await render();
    TestBed.tick();
    expect(view.driver.ghost).toEqual({
      role: 'start',
      label: 'A',
      text: 'Click to set the start',
      refusedText: 'No road close to this place for this profile.',
    });
    view.click(3.087, 45.777);
    TestBed.tick();
    expect(view.driver.ghost?.role).toBe('end');
    view.click(3.249, 45.544);
    view.click(3.2, 45.6);
    TestBed.tick();
    expect(view.driver.ghost).toEqual({
      role: 'waypoint',
      label: '+',
      text: 'Click to add a stop',
      refusedText: 'No road close to this place for this profile.',
    });
  });

  it('draws a closed loop as one combined marker', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    TestBed.inject(PlannerStore).closeLoop();
    TestBed.tick();
    expect(view.driver.markers.map((m) => [m.role, m.label, m.loop])).toEqual([
      ['start', '↻', true],
      ['waypoint', '1', false],
    ]);
  });

  it('computes the route and draws it, with distance, climb and duration', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    expect(requests).toEqual([
      {
        points: [
          { lon: 3.087, lat: 45.777 },
          { lon: 3.249, lat: 45.544 },
        ],
        profile: 'road',
        alternatives: 1,
      },
    ]);
    expect(view.driver.routes).toHaveLength(1);
    expect(view.driver.selected).toBe(0);
    expect(view.text()).toContain('Route 1');
    expect(view.text()).toMatch(/41(\.0)? km/);
  });

  it('highlights on the map the stretch picked on the profile', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    expect(view.driver.highlight).toBeNull();

    const store = TestBed.inject(PlannerStore);
    const geometry = store.selectedGeometry();
    store.selectStretch([0, 1]);
    TestBed.tick();
    expect(view.driver.highlight).toEqual(geometry.slice(0, 2));

    store.selectStretch(null);
    TestBed.tick();
    expect(view.driver.highlight).toBeNull();
  });

  it('links the elevation profile and the map: hovering one moves the dot on the other', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    expect(
      view.root.querySelector('vl-elevation-panel .profile'),
    ).not.toBeNull();
    // It starts folded: open it to see the cursor.
    view.root
      .querySelector<HTMLButtonElement>('vl-elevation-panel header button')
      ?.click();
    view.fixture.detectChanges();
    expect(view.driver.cursor).toBeNull();

    // Hovering the route on the map puts the cursor on the profile.
    view.driver.handlers.onHoverRoute([3.249, 45.544]);
    view.fixture.detectChanges();
    TestBed.tick();
    expect(view.driver.cursor).toEqual([3.249, 45.544]);
    expect(view.root.querySelector('.tooltip')).not.toBeNull();

    // Leaving the route hides both.
    view.driver.handlers.onHoverRoute(null);
    view.fixture.detectChanges();
    TestBed.tick();
    expect(view.driver.cursor).toBeNull();
    expect(view.root.querySelector('.tooltip')).toBeNull();
  });

  it('recomputes with the chosen profile', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    const select = view.root.querySelector('vl-profile-select') as HTMLElement;
    const radios = select.querySelectorAll<HTMLElement>('[role=radio]');
    expect(radios[2].textContent).toContain('Trail');
    radios[2].click();
    await view.settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].profile).toBe('trail');
  });

  it('shows alternatives and lets the user pick one, in the panel or on the map', async () => {
    respond = (count) => json(routes(count));
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    const select = view.root.querySelector('select') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    await view.settle();
    expect(requests.at(-1)?.alternatives).toBe(3);
    expect(view.driver.routes).toHaveLength(3);

    const buttons = Array.from(
      view.root.querySelectorAll<HTMLButtonElement>('.routes button'),
    );
    expect(buttons).toHaveLength(3);
    buttons[2].click();
    view.fixture.detectChanges();
    TestBed.tick();
    expect(view.driver.selected).toBe(2);
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    // A click on its card shows the whole route on the map; a click on the map does not move it.
    const fits = view.driver.fitted.length;
    expect(fits).toBeGreaterThan(0);
    expect(view.driver.fitted.at(-1)).toEqual(view.driver.routes[2]);

    view.driver.handlers.onSelectRoute(1);
    view.fixture.detectChanges();
    TestBed.tick();
    expect(view.driver.selected).toBe(1);
    expect(view.driver.fitted).toHaveLength(fits);
  });

  it('moves a point dragged on the map and recomputes', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    view.driver.handlers.onMovePoint(1, [3.3, 45.5]);
    await view.settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].points[1]).toEqual({ lon: 3.3, lat: 45.5 });
  });

  describe('dragging on the map', () => {
    async function dragging() {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      const store = TestBed.inject(PlannerStore);
      /** Lets `ms` pass, with the effects and the request that follow. */
      const pass = async (ms: number) => {
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(ms);
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(1);
        TestBed.tick();
        view.fixture.detectChanges();
      };
      return { ...view, store, pass, handlers: view.driver.handlers };
    }

    it('recomputes the route while a marker moves, at a steady pace', async () => {
      const view = await dragging();
      view.handlers.onDragStart();
      view.fixture.detectChanges();
      expect(view.text()).toContain('Press Escape to put it back.');
      for (let i = 1; i <= 20; i++) {
        view.handlers.onDragPoint(1, [3.249 + i / 1000, 45.544]);
      }
      // Nothing is asked at every move of the pointer.
      expect(requests).toHaveLength(1);
      await view.pass(LIVE_DRAG_INTERVAL_MS);
      expect(requests).toHaveLength(2);
      expect(requests[1].points.at(-1)).toEqual({ lon: 3.269, lat: 45.544 });

      view.handlers.onDragPoint(1, [3.28, 45.544]);
      view.handlers.onDragPoint(1, [3.29, 45.544]);
      // The first route came half an interval after the start; the next one waits a whole one.
      await view.pass(LIVE_DRAG_INTERVAL_MS / 4);
      expect(requests).toHaveLength(2);
      await view.pass(LIVE_DRAG_INTERVAL_MS / 2);
      expect(requests).toHaveLength(3);
      expect(requests[2].points.at(-1)).toEqual({ lon: 3.29, lat: 45.544 });
    });

    it('keeps the drop and undoes the whole drag in one step', async () => {
      const view = await dragging();
      view.handlers.onDragStart();
      view.handlers.onDragPoint(1, [3.26, 45.544]);
      await view.pass(LIVE_DRAG_INTERVAL_MS);
      view.handlers.onDragPoint(1, [3.27, 45.544]);
      view.handlers.onMovePoint(1, [3.3, 45.5]);
      await view.settle();
      expect(view.store.dragging()).toBe(false);
      expect(view.store.points()[1]).toEqual([3.3, 45.5]);
      expect(requests.at(-1)!.points.at(-1)).toEqual({ lon: 3.3, lat: 45.5 });
      const count = requests.length;
      // The place the pointer went through before the drop is not asked afterwards.
      await view.pass(2 * LIVE_DRAG_INTERVAL_MS);
      expect(requests).toHaveLength(count);

      view.store.undo();
      expect(view.store.points()[1]).toEqual([3.249, 45.544]);
      view.store.undo();
      expect(view.store.points()).toHaveLength(1);
    });

    it('puts the point and the route back on Escape', async () => {
      const view = await dragging();
      const route = view.store.routes();
      view.handlers.onDragStart();
      view.handlers.onDragPoint(1, [3.26, 45.544]);
      await view.pass(LIVE_DRAG_INTERVAL_MS);
      view.handlers.onDragPoint(1, [3.27, 45.544]);
      const count = requests.length;

      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(view.driver.cancelledDrags).toBe(1);
      expect(view.store.dragging()).toBe(false);
      expect(view.store.points()[1]).toEqual([3.249, 45.544]);
      expect(view.store.routes()).toEqual(route);
      await view.pass(2 * LIVE_DRAG_INTERVAL_MS);
      expect(requests).toHaveLength(count);
      expect(view.store.canRedo()).toBe(false);
    });

    it('does not undo in the middle of a drag', async () => {
      const view = await dragging();
      view.handlers.onDragStart();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
        }),
      );
      expect(view.store.points()).toHaveLength(2);
    });

    it('inserts a waypoint dragged from the route, in the segment it was taken from', async () => {
      const view = await dragging();
      const [lon, lat] = view.store.selectedGeometry()[1];
      view.handlers.onDragStart();
      view.handlers.onDragInsert([lon, lat], [3.2, 45.7]);
      await view.pass(LIVE_DRAG_INTERVAL_MS);
      expect(view.store.points()).toHaveLength(3);
      expect(view.store.points()[1]).toEqual([3.2, 45.7]);
      view.handlers.onDragInsert([lon, lat], [3.21, 45.71]);
      view.handlers.onInsertPoint([lon, lat], [3.22, 45.72]);
      await view.settle();
      expect(view.store.points()).toEqual([
        [3.087, 45.777],
        [3.22, 45.72],
        [3.249, 45.544],
      ]);
      view.store.undo();
      expect(view.store.points()).toHaveLength(2);
    });
  });

  it('draws the route in the colours of what it rides on from the start, until the user turns it off', async () => {
    respond = () =>
      json({
        routes: [{ ...routes(1).routes[0], surfaces: 'pu' }],
      });
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    expect(view.driver.surfaces?.surfaces).toBe('pu');
    expect(view.driver.surfaces?.geometry).toHaveLength(3);

    TestBed.inject(MapLayers).setSurface(false);
    await view.settle();
    expect(view.driver.surfaces).toBeNull();

    TestBed.inject(MapLayers).setSurface(true);
    await view.settle();
    expect(view.driver.surfaces?.surfaces).toBe('pu');
  });

  it('draws no surfaces for a route that does not say', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    expect(view.driver.surfaces).toBeNull();
  });

  describe('the buttons that show the route or a stretch of it on the map', () => {
    it('shows the whole route, gliding, when the button of the map is pressed', async () => {
      const view = await render();
      const fit = () =>
        view.root.querySelector<HTMLButtonElement>('.fit-route')!;
      expect(fit().disabled).toBe(true);
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      expect(fit().disabled).toBe(false);
      const before = view.driver.fitted.length;
      fit().click();
      view.fixture.detectChanges();
      TestBed.tick();
      expect(view.driver.fitted.length).toBe(before + 1);
      expect(view.driver.fitted.at(-1)).toHaveLength(3);
      expect(view.driver.fittedAnimated.at(-1)).toBe(true);
    });

    it('shows the selected stretch of the profile, and only when asked', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      // The profile starts folded: open it to reach the zoom button.
      view.root
        .querySelector<HTMLButtonElement>('vl-elevation-panel header button')
        ?.click();
      view.fixture.detectChanges();
      const store = TestBed.inject(PlannerStore);
      store.selectStretch([0, 1]);
      view.fixture.detectChanges();
      TestBed.tick();
      const before = view.driver.fitted.length;
      view.root.querySelector<HTMLButtonElement>('.stretch-zoom')!.click();
      view.fixture.detectChanges();
      TestBed.tick();
      expect(view.driver.fitted.length).toBe(before + 1);
      expect(view.driver.fitted.at(-1)).toEqual(
        store.selectedGeometry().slice(0, 2),
      );
    });
  });

  describe('a click on the map with a route on screen', () => {
    const straight = () => [
      {
        geometry: Array.from(
          { length: 31 },
          (_, i): [number, number, number] => [i / 100, 0, 100],
        ),
        distanceMeters: 33_000,
        ascentMeters: 0,
        durationSeconds: 3600,
      },
    ];

    /** A route A, S1, S2, B along the equator; `onScreen` puts it on screen as a straight line. */
    async function renderWithRoute(onScreen = true) {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      store.addPoint([0, 0]);
      store.addPoint([0.3, 0]);
      store.addPoint([0.1, 0]);
      store.addPoint([0.2, 0]);
      expect(store.points().map((p) => p[0])).toEqual([0, 0.1, 0.2, 0.3]);
      if (onScreen) {
        // The planner has started its computation for these points; the route arrives.
        TestBed.tick();
        store.setRoutes(straight());
      }
      return { view, store };
    }
    const lons = (store: PlannerStore) => store.points().map((p) => p[0]);

    it('puts the new stop between the points whose stretch it is on, or beside', async () => {
      const { view, store } = await renderWithRoute();
      // On the stretch between the start and the first stop.
      view.driver.handlers.onClick([0.05, 0.001]);
      expect(lons(store)).toEqual([0, 0.05, 0.1, 0.2, 0.3]);
      store.setRoutes(straight());
      // Beside the stretch between the two later stops.
      view.driver.handlers.onClick([0.15, 0.002]);
      expect(lons(store)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.3]);
    });

    it('still goes before the end when it is on the last stretch', async () => {
      const { view, store } = await renderWithRoute();
      view.driver.handlers.onClick([0.25, 0.001]);
      expect(lons(store)).toEqual([0, 0.1, 0.2, 0.25, 0.3]);
    });

    it('does the same for "Add a stop here" in the map menu', async () => {
      const { view, store } = await renderWithRoute();
      view.driver.handlers.onContextMenu([0.05, 0.001], { x: 40, y: 60 });
      view.fixture.detectChanges();
      Array.from(
        view.root.querySelectorAll<HTMLButtonElement>('.map-menu button'),
      )
        .find((b) => b.textContent?.includes('Add a stop here'))!
        .click();
      expect(lons(store)).toEqual([0, 0.05, 0.1, 0.2, 0.3]);
    });

    it('adds before the end while no route is on screen', async () => {
      const { view, store } = await renderWithRoute(false);
      view.driver.handlers.onClick([0.05, 0.001]);
      expect(lons(store)).toEqual([0, 0.1, 0.2, 0.05, 0.3]);
    });
  });

  it('removes a stop from the panel or with the map handler', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.15, 45.65);
    view.click(3.249, 45.544);
    // The start and the end have their fields: only the stops are listed.
    expect(view.root.querySelectorAll('.points__stop')).toHaveLength(1);
    const remove = view.root.querySelector(
      '.points__stop .point-remove',
    ) as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove Waypoint 1');
    remove.click();
    view.fixture.detectChanges();
    expect(view.root.querySelector('.points__stop')).toBeNull();
    expect(TestBed.inject(PlannerStore).points()).toHaveLength(2);
    view.driver.handlers.onRemovePoint(0);
    view.fixture.detectChanges();
    expect(TestBed.inject(PlannerStore).points()).toHaveLength(1);
  });

  it('clears everything, markers and routes included', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    (view.root.querySelector('.clear') as HTMLButtonElement).click();
    view.fixture.detectChanges();
    await view.settle();
    expect(view.driver.markers).toEqual([]);
    expect(view.driver.routes).toEqual([]);
    expect(view.root.querySelector('.points__stop')).toBeNull();
    expect(view.text()).toContain('Click the map to set the start.');
  });

  describe('reordering the steps', () => {
    const pointer = (target: EventTarget, type: string, clientY = 0) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientY,
      });
      target.dispatchEvent(event);
      return event;
    };

    /** Three rows 40 px high, one after the other, as the layout would put them. */
    const layOut = (rows: NodeListOf<Element>) =>
      rows.forEach((row, i) => {
        row.getBoundingClientRect = () =>
          ({ top: i * 40, height: 40 }) as DOMRect;
      });

    const threeStops = async () => {
      const view = await render();
      view.click(3.0, 45.0);
      view.click(3.1, 45.1);
      view.click(3.2, 45.2);
      view.click(3.3, 45.3);
      view.click(3.4, 45.4);
      view.fixture.detectChanges();
      return view;
    };

    it('shows the new order while a stop is dragged and computes once on release', async () => {
      const view = await threeStops();
      const store = TestBed.inject(PlannerStore);
      const before = store.points();
      // The points are the start, three stops, and the end.
      expect(before).toHaveLength(5);
      const rows = () => view.root.querySelectorAll('.points__stop');
      layOut(rows());
      const grip = rows()[0].querySelector('.point-grip') as HTMLElement;
      // A button, before the field, with the number of the stop (the field leaves it out).
      expect(grip.tagName).toBe('BUTTON');
      expect(rows()[0].firstElementChild).toBe(grip);
      expect(grip.textContent).toContain('1');
      pointer(grip, 'pointerdown', 20);
      view.fixture.detectChanges();
      expect(rows()[0].classList.contains('dragging')).toBe(true);
      expect(view.text()).toContain('Release to move the stop here');
      // The "+" stay (the list keeps its height), but are out of use.
      const gaps = view.root.querySelectorAll('.points__gap');
      expect(gaps.length).toBeGreaterThan(0);
      gaps.forEach((gap) => expect(gap.hasAttribute('inert')).toBe(true));
      // The pointer goes below the middle of the second row: the first stop takes place 2.
      pointer(document, 'pointermove', 70);
      view.fixture.detectChanges();
      // The numbers stay while the stop moves: they change on release.
      expect(grip.textContent).toContain('1');
      expect(rows()[1].querySelector('.point-grip')?.textContent).toContain(
        '2',
      );
      expect((rows()[0] as HTMLElement).style.order).toBe('4');
      expect((rows()[1] as HTMLElement).style.order).toBe('2');
      // Nothing changed in the store yet.
      expect(store.points()).toEqual(before);
      pointer(document, 'pointerup', 70);
      TestBed.tick();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([
        before[0],
        before[2],
        before[1],
        before[3],
        before[4],
      ]);
      expect(view.root.querySelector('.dragging')).toBeNull();
      expect(view.text()).not.toContain('Release to move the stop here');
      expect(view.root.querySelector('.points__gap[inert]')).toBeNull();
    });

    it('puts the stop back on Escape, with no change', async () => {
      const view = await threeStops();
      const store = TestBed.inject(PlannerStore);
      const before = store.points();
      const rows = () => view.root.querySelectorAll('.points__stop');
      layOut(rows());
      pointer(rows()[0].querySelector('.point-grip')!, 'pointerdown', 20);
      pointer(document, 'pointermove', 110);
      view.fixture.detectChanges();
      expect(view.root.querySelector('.dragging')).not.toBeNull();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      view.fixture.detectChanges();
      expect(view.root.querySelector('.dragging')).toBeNull();
      // A release after the cancel does nothing.
      pointer(document, 'pointerup', 110);
      expect(store.points()).toEqual(before);
    });

    it('moves a stop with the arrow keys and says where it went', async () => {
      const view = await threeStops();
      const store = TestBed.inject(PlannerStore);
      const before = store.points();
      const rows = () => view.root.querySelectorAll('.points__stop');
      const grip = rows()[1].querySelector('.point-grip') as HTMLElement;
      grip.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        }),
      );
      TestBed.tick();
      view.fixture.detectChanges();
      expect(store.points().slice(1, 3)).toEqual([before[2], before[1]]);
      expect(
        view.root.querySelector('.visually-hidden[aria-live]')?.textContent,
      ).toContain('moved to position 1 of 3');
      // The first stop cannot go higher.
      const first = rows()[0].querySelector('.point-grip') as HTMLElement;
      const upper = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      });
      const points = store.points();
      first.dispatchEvent(upper);
      expect(store.points()).toEqual(points);
    });

    it('has no handle for a single stop, only its number, and one for each of several', async () => {
      const view = await render();
      view.click(3.0, 45.0);
      view.click(3.1, 45.1);
      view.click(3.2, 45.2);
      view.fixture.detectChanges();
      // A start, one stop and an end: nothing to reorder the stop with.
      expect(view.root.querySelectorAll('.points__stop')).toHaveLength(1);
      expect(view.root.querySelector('button.point-grip')).toBeNull();
      const badge = view.root.querySelector('.point-grip--static')!;
      expect(badge.textContent).toContain('1');
      expect(badge.getAttribute('aria-hidden')).toBe('true');
      // A second stop brings the handles back.
      view.click(3.3, 45.3);
      view.fixture.detectChanges();
      expect(view.root.querySelectorAll('button.point-grip')).toHaveLength(2);
      expect(view.root.querySelector('.point-grip--static')).toBeNull();
    });

    it('lists no stops while there are only a start and an end', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      expect(view.root.querySelector('.points__stop')).toBeNull();
    });
  });

  describe('undo and redo', () => {
    const press = (
      key: string,
      init: KeyboardEventInit = {},
      target?: Element,
    ) => {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      (target ?? document.body).dispatchEvent(event);
      return event;
    };
    const buttons = (root: HTMLElement) => ({
      undo: root.querySelector('.history__undo') as HTMLButtonElement,
      redo: root.querySelector('.history__redo') as HTMLButtonElement,
    });

    it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      const store = TestBed.inject(PlannerStore);
      expect(press('z').defaultPrevented).toBe(true);
      expect(store.points()).toHaveLength(1);
      press('Z', { shiftKey: true });
      expect(store.points()).toHaveLength(2);
      press('z');
      press('y');
      expect(store.points()).toHaveLength(2);
      press('z', { ctrlKey: false, metaKey: true });
      expect(store.points()).toHaveLength(1);
    });

    it('leaves Ctrl+Z to a field, and ignores other keys and the dialog', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      const store = TestBed.inject(PlannerStore);
      const field = document.createElement('input');
      field.type = 'number';
      document.body.append(field);
      expect(press('z', {}, field).defaultPrevented).toBe(false);
      field.remove();
      expect(press('x').defaultPrevented).toBe(false);
      expect(press('z', { ctrlKey: false }).defaultPrevented).toBe(false);
      expect(store.points()).toHaveLength(2);
      (view.root.querySelector('.loop') as HTMLButtonElement).click();
      view.fixture.detectChanges();
      press('z');
      expect(store.points()).toHaveLength(2);
    });

    it('has buttons that follow what can be undone and redone', async () => {
      const view = await render();
      const { undo, redo } = buttons(view.root);
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(true);
      view.click(3.087, 45.777);
      expect(undo.disabled).toBe(false);
      undo.click();
      view.fixture.detectChanges();
      expect(TestBed.inject(PlannerStore).points()).toEqual([]);
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(false);
      redo.click();
      view.fixture.detectChanges();
      expect(TestBed.inject(PlannerStore).points()).toHaveLength(1);
    });

    it('stops listening to the keys when the planner is destroyed', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.destroy();
      expect(press('z').defaultPrevented).toBe(false);
      expect(TestBed.inject(PlannerStore).points()).toHaveLength(1);
    });
  });

  describe('errors', () => {
    it.each([
      [
        422,
        { code: 'no_route', message: 'x' },
        'No route found between these points',
        'Aucun parcours trouvé entre ces points',
      ],
      [
        503,
        { code: 'unavailable', message: 'x' },
        'routing service is not available',
        "n'est pas disponible",
      ],
      [
        429,
        { statusCode: 429, message: 'Rate limit exceeded' },
        'Too many requests',
        'Trop de requêtes',
      ],
    ] as const)(
      'translates an API %i, never showing the raw message',
      async (status, body, english, french) => {
        respond = () => json(body, status);
        const view = await render();
        view.click(3.087, 45.777);
        view.click(3.249, 45.544);
        await view.settle();
        const alert = view.root.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain(english);
        expect(alert.textContent).not.toContain('Rate limit exceeded');
        expect(view.driver.routes).toEqual([]);

        TestBed.inject(LanguageService).use('fr');
        await flush();
        view.fixture.detectChanges();
        expect(alert.textContent).toContain(french);
      },
    );

    it('reports an unreachable API', async () => {
      TestBed.resetTestingModule();
      drivers.length = 0;
      await TestBed.configureTestingModule({
        imports: [Planner],
        providers: [
          provideTestTransloco(),
          provideFakeMap([] as FakeMap[]),
          provideFakePlannerDriver(drivers),
          provideInMemoryRouteStore(),
          {
            provide: API_CLIENT,
            useValue: createApiClient({
              baseUrl: 'http://api.test',
              fetch: async () => {
                throw new TypeError('Failed to fetch');
              },
            }),
          },
        ],
      }).compileComponents();
      TestBed.inject(LanguageService).init();
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await view.settle();
      expect(view.root.querySelector('[role="alert"]')?.textContent).toContain(
        'routing service is not available',
      );
    });
  });

  it('translates the panel and the marker names', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    TestBed.inject(LanguageService).use('fr');
    await flush();
    view.fixture.detectChanges();
    TestBed.tick();
    expect(view.text()).toContain('Planificateur de parcours');
    expect(
      view.root
        .querySelector('vl-place-field input')
        ?.getAttribute('aria-label'),
    ).toBe('Départ');
    expect(view.driver.markers[0].ariaLabel).toBe('Départ');
  });

  describe('start and end search', () => {
    const gare = { label: 'Gare de Lyon, Paris', lon: 2.37, lat: 48.84 };
    const mairie = { label: 'Mairie, Lyon', lon: 4.83, lat: 45.76 };
    const inputs = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLInputElement>('vl-place-field input'),
      );

    async function type(
      view: Awaited<ReturnType<typeof render>>,
      input: HTMLInputElement,
      text: string,
    ) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      view.fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10);
      view.fixture.detectChanges();
    }

    const options = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLElement>('[role=option]'));
    /** The "+" buttons between the fields. */
    const adds = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.add-stop'));

    beforeEach(() => {
      geocode = (url) =>
        url.pathname === '/geocode/reverse'
          ? json({ place: null })
          : json({
              places: url.searchParams.get('q')?.includes('lyon')
                ? [gare, mairie]
                : [],
            });
    });

    it('finds the start, puts it on the map and names it', async () => {
      const view = await render();
      const [start] = inputs(view.root);
      await type(view, start, 'gare de lyon');
      expect(geocoded).toHaveLength(1);
      expect(geocoded[0]).toContain('q=gare%20de%20lyon');
      expect(options(view.root).map((o) => o.textContent?.trim())).toEqual([
        gare.label,
        mairie.label,
      ]);
      options(view.root)[0].click();
      view.fixture.detectChanges();
      const store = TestBed.inject(PlannerStore);
      expect(store.points()).toEqual([[gare.lon, gare.lat]]);
      expect(store.labelOf([gare.lon, gare.lat])).toBe(gare.label);
      expect(view.driver.centered).toEqual([[gare.lon, gare.lat]]);
      expect(inputs(view.root)[0].value).toBe(gare.label);
      expect(options(view.root)).toHaveLength(0);
    });

    it('shows a spinner from the first keystroke until the answer arrives', async () => {
      const view = await render();
      const [start] = inputs(view.root);
      start.value = 'gare';
      start.dispatchEvent(new Event('input'));
      view.fixture.detectChanges();
      // Typing paused, request not sent yet: already busy.
      expect(view.root.querySelector('.spinner')).not.toBeNull();
      expect(start.getAttribute('aria-busy')).toBe('true');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10);
      view.fixture.detectChanges();
      expect(view.root.querySelector('.spinner')).toBeNull();
      expect(start.getAttribute('aria-busy')).toBe('false');
    });

    it('shows the whole route, not just the new point, when a place is added to a start', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      view.fixture.detectChanges();
      const field = inputs(view.root).at(-1) as HTMLInputElement;
      await type(view, field, 'gare de lyon');
      options(view.root)[0].click();
      view.fixture.detectChanges();
      expect(TestBed.inject(PlannerStore).points()).toHaveLength(2);
      expect(view.driver.pointsFitted.at(-1)).toEqual([
        [3.087, 45.777],
        [gare.lon, gare.lat],
      ]);
      expect(view.driver.centered).toEqual([]);
    });

    it('picks a suggestion with the keyboard', async () => {
      const view = await render();
      const [start] = inputs(view.root);
      await type(view, start, 'lyon');
      const key = (name: string) => {
        const event = new KeyboardEvent('keydown', {
          key: name,
          bubbles: true,
          cancelable: true,
        });
        start.dispatchEvent(event);
        view.fixture.detectChanges();
        return event;
      };
      key('ArrowDown');
      key('ArrowDown');
      expect(options(view.root)[1].getAttribute('aria-selected')).toBe('true');
      expect(start.getAttribute('aria-activedescendant')).toBe(
        options(view.root)[1].id,
      );
      expect(key('Enter').defaultPrevented).toBe(true);
      expect(TestBed.inject(PlannerStore).points()).toEqual([
        [mairie.lon, mairie.lat],
      ]);
    });

    it('does not search a text that is too short, nor after Escape', async () => {
      const view = await render();
      const [start] = inputs(view.root);
      await type(view, start, 'g');
      expect(geocoded).toHaveLength(0);
      await type(view, start, 'lyon');
      start.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      view.fixture.detectChanges();
      expect(options(view.root)).toHaveLength(0);
      expect(start.value).toBe('');
    });

    it('says when nothing is found and when the search fails', async () => {
      const view = await render();
      const [start] = inputs(view.root);
      await type(view, start, 'nowhere');
      expect(view.text()).toContain('No place found.');
      geocode = () => json({ code: 'unavailable', message: 'down' }, 503);
      await type(view, start, 'lyon');
      expect(view.text()).toContain('Place search is not available');
    });

    it('blocks the end until there is a start, then sets the end', async () => {
      const view = await render();
      const [start, end] = inputs(view.root);
      expect(end.disabled).toBe(true);
      await type(view, start, 'gare de lyon');
      options(view.root)[0].click();
      view.fixture.detectChanges();
      expect(inputs(view.root)[1].disabled).toBe(false);
      await type(view, inputs(view.root)[1], 'lyon');
      options(view.root)[1].click();
      view.fixture.detectChanges();
      const store = TestBed.inject(PlannerStore);
      expect(store.points()).toEqual([
        [gare.lon, gare.lat],
        [mairie.lon, mairie.lat],
      ]);
      expect(inputs(view.root).map((i) => i.value)).toEqual([
        gare.label,
        mairie.label,
      ]);
    });

    it('shows each stop as a field and moves it to the place found', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      view.click(3.0, 45.0);
      view.click(3.2, 45.2);
      view.click(3.1, 45.1);
      view.fixture.detectChanges();
      const stop = () =>
        view.root.querySelector('.points__stop input') as HTMLInputElement;
      expect(stop().getAttribute('aria-label')).toBe('Stop 1');
      // A stop set on the map has no name: its coordinates stand for it.
      expect(stop().value).toContain('45.1');
      await type(view, stop(), 'gare de lyon');
      options(view.root)[0].click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([
        [3.0, 45.0],
        [gare.lon, gare.lat],
        [3.2, 45.2],
      ]);
      expect(stop().value).toBe(gare.label);
      // The route is on screen: the view takes in all of it, not only the new place.
      expect(view.driver.pointsFitted.at(-1)).toContainEqual([
        gare.lon,
        gare.lat,
      ]);
    });

    it('adds a stop by search, just before the end', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      view.click(3.0, 45.0);
      view.fixture.detectChanges();
      expect(adds(view.root)).toHaveLength(0);
      view.click(3.2, 45.2);
      view.fixture.detectChanges();
      expect(adds(view.root)).toHaveLength(1);
      expect(adds(view.root)[0].getAttribute('aria-label')).toBe(
        'Add a stop between Start and End',
      );
      adds(view.root)[0].click();
      view.fixture.detectChanges();
      expect(adds(view.root)).toHaveLength(0);
      const field = view.root.querySelector(
        '.points__new input',
      ) as HTMLInputElement;
      expect(field.value).toBe('');
      // Nothing changes until a place is picked.
      expect(store.points()).toHaveLength(2);
      await type(view, field, 'lyon');
      options(view.root)[1].click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([
        [3.0, 45.0],
        [mairie.lon, mairie.lat],
        [3.2, 45.2],
      ]);
      expect(store.labelOf([mairie.lon, mairie.lat])).toBe(mairie.label);
      expect(view.root.querySelector('.points__new')).toBeNull();
      expect(view.root.querySelectorAll('.points__stop')).toHaveLength(1);
      // One "+" on each side of the stop, and no other button to add one.
      expect(adds(view.root)).toHaveLength(2);
    });

    it('adds a stop by search between any two points', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      view.click(3.0, 45.0);
      view.click(3.1, 45.1);
      view.click(3.2, 45.2);
      view.click(3.3, 45.3);
      view.fixture.detectChanges();
      const before = store.points();
      expect(adds(view.root)).toHaveLength(3);
      // Between the start and the first stop.
      adds(view.root)[0].click();
      view.fixture.detectChanges();
      const rows = [...view.root.querySelectorAll('.points > li')];
      expect(rows[0].classList.contains('points__new')).toBe(true);
      // Another "+" moves the empty field: here between the two stops.
      adds(view.root)[0].click();
      view.fixture.detectChanges();
      expect(view.root.querySelectorAll('.points__new')).toHaveLength(1);
      expect(
        [...view.root.querySelectorAll('.points > li')].findIndex((row) =>
          row.classList.contains('points__new'),
        ),
      ).toBe(2);
      await type(
        view,
        view.root.querySelector('.points__new input') as HTMLInputElement,
        'lyon',
      );
      options(view.root)[1].click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([
        before[0],
        before[1],
        [mairie.lon, mairie.lat],
        before[2],
        before[3],
      ]);

      adds(view.root)[0].click();
      view.fixture.detectChanges();
      await type(
        view,
        view.root.querySelector('.points__new input') as HTMLInputElement,
        'gare de lyon',
      );
      options(view.root)[0].click();
      view.fixture.detectChanges();
      expect(store.points()[1]).toEqual([gare.lon, gare.lat]);
      expect(store.points()).toHaveLength(6);
    });

    it('closes the empty field of a new stop when the points change', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      view.click(3.0, 45.0);
      view.click(3.2, 45.2);
      view.fixture.detectChanges();
      adds(view.root)[0].click();
      view.fixture.detectChanges();
      store.undo();
      view.fixture.detectChanges();
      store.redo();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.points__new')).toBeNull();
      expect(adds(view.root)).toHaveLength(1);
    });

    it('gives up a new stop', async () => {
      const view = await render();
      view.click(3.0, 45.0);
      view.click(3.2, 45.2);
      view.fixture.detectChanges();
      adds(view.root)[0].click();
      view.fixture.detectChanges();
      (
        view.root.querySelector('.points__new button') as HTMLButtonElement
      ).click();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.points__new')).toBeNull();
      expect(adds(view.root)).toHaveLength(1);
      expect(TestBed.inject(PlannerStore).points()).toHaveLength(2);
    });

    describe('my position in the fields', () => {
      const focus = (
        view: { fixture: { detectChanges(): void } },
        input: HTMLInputElement,
      ) => {
        input.dispatchEvent(new FocusEvent('focus'));
        view.fixture.detectChanges();
      };
      const position = (root: HTMLElement) =>
        root.querySelector<HTMLElement>('.suggestions__position');

      it('offers it in an empty field and waits for the device', async () => {
        const view = await render();
        const store = TestBed.inject(PlannerStore);
        const [start] = inputs(view.root);
        expect(position(view.root)).toBeNull();
        focus(view, start);
        expect(position(view.root)?.textContent).toContain('My position');
        position(view.root)?.click();
        view.fixture.detectChanges();
        // The device was asked, and nothing moves before it answers.
        expect(geolocation.starts).toBe(1);
        expect(store.points()).toEqual([]);
        expect(position(view.root)).toBeNull();
        geolocation.emit({ position: [3.1, 45.7] });
        view.fixture.detectChanges();
        expect(store.points()).toEqual([[3.1, 45.7]]);
        expect(view.driver.centered).toEqual([[3.1, 45.7]]);
        // Later positions move nothing.
        geolocation.emit({ position: [3.5, 45.9] });
        view.fixture.detectChanges();
        expect(store.points()).toEqual([[3.1, 45.7]]);
      });

      it('sets the end, a stop and a new stop from a known position', async () => {
        const view = await render();
        const store = TestBed.inject(PlannerStore);
        view.click(3.0, 45.0);
        TestBed.inject(LocationStore).start();
        geolocation.emit({ position: [3.2, 45.2] });
        view.fixture.detectChanges();
        focus(view, inputs(view.root)[1]);
        const key = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        inputs(view.root)[1].dispatchEvent(key);
        view.fixture.detectChanges();
        expect(key.defaultPrevented).toBe(true);
        expect(store.points()).toEqual([
          [3.0, 45.0],
          [3.2, 45.2],
        ]);

        geolocation.emit({ position: [3.1, 45.1] });
        adds(view.root)[0].click();
        view.fixture.detectChanges();
        const added = view.root.querySelector(
          '.points__new input',
        ) as HTMLInputElement;
        focus(view, added);
        position(view.root)?.click();
        view.fixture.detectChanges();
        expect(store.points()).toEqual([
          [3.0, 45.0],
          [3.1, 45.1],
          [3.2, 45.2],
        ]);
        expect(view.root.querySelector('.points__new')).toBeNull();
        // A field that shows a point offers nothing.
        focus(
          view,
          view.root.querySelector('.points__stop input') as HTMLInputElement,
        );
        expect(position(view.root)).toBeNull();
      });

      it('offers nothing without a device', async () => {
        geolocation.supported = 'insecure';
        const view = await render();
        focus(view, inputs(view.root)[0]);
        expect(position(view.root)).toBeNull();
      });

      it('gives up when the position is refused', async () => {
        const view = await render();
        const store = TestBed.inject(PlannerStore);
        focus(view, inputs(view.root)[0]);
        position(view.root)?.click();
        geolocation.fail('denied');
        view.fixture.detectChanges();
        TestBed.inject(LocationStore).start();
        geolocation.emit({ position: [3.1, 45.7] });
        view.fixture.detectChanges();
        expect(store.points()).toEqual([]);
      });
    });

    it('reverses the route, names included', async () => {
      const view = await render();
      const store = TestBed.inject(PlannerStore);
      store.setStart([gare.lon, gare.lat]);
      store.setLabel([gare.lon, gare.lat], gare.label);
      store.addPoint([mairie.lon, mairie.lat]);
      store.setLabel([mairie.lon, mairie.lat], mairie.label);
      view.fixture.detectChanges();
      const swap = view.root.querySelector('.swap') as HTMLButtonElement;
      expect(swap.disabled).toBe(false);
      swap.click();
      view.fixture.detectChanges();
      expect(store.points()).toEqual([
        [mairie.lon, mairie.lat],
        [gare.lon, gare.lat],
      ]);
      expect(inputs(view.root).map((i) => i.value)).toEqual([
        mairie.label,
        gare.label,
      ]);
    });

    it('cannot reverse a single point or a loop without stops', async () => {
      const view = await render();
      const swap = () => view.root.querySelector('.swap') as HTMLButtonElement;
      expect(swap().disabled).toBe(true);
      view.click(3.0, 45.0);
      expect(swap().disabled).toBe(true);
      view.click(3.1, 45.1);
      expect(swap().disabled).toBe(false);
      TestBed.inject(PlannerStore).closeLoop();
      view.fixture.detectChanges();
      expect(swap().disabled).toBe(true);
    });

    it('shows the address found for a point placed on the map, and coordinates before', async () => {
      geocode = (url) =>
        url.pathname === '/geocode/reverse'
          ? json({
              place: {
                label: `Rue ${url.searchParams.get('lon')}`,
                lon: 0,
                lat: 0,
              },
            })
          : json({ places: [] });
      const view = await render();
      view.click(3.087, 45.777);
      expect(inputs(view.root)[0].value).toBe('45.7770, 3.0870');
      await vi.advanceTimersByTimeAsync(NAME_DEBOUNCE_MS + 10);
      TestBed.tick();
      view.fixture.detectChanges();
      expect(geocoded).toHaveLength(1);
      expect(inputs(view.root)[0].value).toBe('Rue 3.087');
      // Only the start and the end are looked up, and each place once.
      view.click(3.15, 45.65);
      view.click(3.249, 45.544);
      await vi.advanceTimersByTimeAsync(NAME_DEBOUNCE_MS + 10);
      expect(geocoded).toHaveLength(2);
    });

    it('names both ends even when one answer comes after the other', async () => {
      const later: (() => void)[] = [];
      geocode = (url) => {
        const lon = url.searchParams.get('lon');
        const answer = () =>
          json({
            place: {
              label: `Rue ${lon}`,
              short: `Ville ${lon}`,
              lon: 0,
              lat: 0,
            },
          });
        // The start answers last: the answer for the end must not cancel it.
        return lon === '3.087'
          ? new Promise<Response>((resolve) =>
              later.push(() => resolve(answer())),
            )
          : answer();
      };
      const view = await render();
      view.click(3.087, 45.777);
      view.click(3.249, 45.544);
      await vi.advanceTimersByTimeAsync(NAME_DEBOUNCE_MS + 10);
      TestBed.tick();
      expect(geocoded).toHaveLength(2);
      const store = TestBed.inject(PlannerStore);
      expect(store.shortOf([3.249, 45.544])).toBe('Ville 3.249');
      later.forEach((answer) => answer());
      await vi.advanceTimersByTimeAsync(NAME_DEBOUNCE_MS + 10);
      TestBed.tick();
      expect(store.shortOf([3.087, 45.777])).toBe('Ville 3.087');
      expect(store.labelOf([3.087, 45.777])).toBe('Rue 3.087');
      // Nothing was asked twice.
      expect(geocoded).toHaveLength(2);
    });

    it('keeps the coordinates when the address cannot be found', async () => {
      geocode = () => json({ code: 'unavailable', message: 'down' }, 503);
      const view = await render();
      view.click(3.087, 45.777);
      await vi.advanceTimersByTimeAsync(NAME_DEBOUNCE_MS + 10);
      TestBed.tick();
      view.fixture.detectChanges();
      expect(inputs(view.root)[0].value).toBe('45.7770, 3.0870');
    });
  });

  describe('offline', () => {
    it('disables the search fields and explains why, without asking for addresses', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const view = await render();
      view.click(3.087, 45.777);
      await vi.advanceTimersByTimeAsync(NAME_DEBOUNCE_MS + 10);
      view.fixture.detectChanges();
      const fields = Array.from(
        view.root.querySelectorAll<HTMLInputElement>('vl-place-field input'),
      );
      expect(fields.every((field) => field.disabled)).toBe(true);
      expect(view.text()).toContain('Place search needs a connection.');
      expect(geocoded).toHaveLength(0);
      vi.restoreAllMocks();
    });
  });

  describe('points on ways', () => {
    // A road along latitude 45, whatever the tile asked for; 0.0001° of latitude is about 11 m.
    const road: Way = {
      kind: 'minor_road',
      detail: 'residential',
      line: [
        [3, 45],
        [3.02, 45],
      ],
    };
    let tilesRead: number;

    async function renderWithWays(ways: Way[] | null = [road]) {
      tilesRead = 0;
      wayTiles = async () => {
        tilesRead++;
        return ways;
      };
      const view = await render();
      return {
        ...view,
        store: TestBed.inject(PlannerStore),
        /** A click, then the time for the tile of ways to be read. */
        async place(lon: number, lat: number) {
          view.click(lon, lat);
          await flush();
          view.fixture.detectChanges();
        },
        alert: () =>
          view.root.querySelector('.refused-toast')?.textContent?.trim() ??
          null,
      };
    }

    it('puts a point clicked beside a road on the road', async () => {
      const view = await renderWithWays();
      await view.place(3.005, 45.0003);
      const [start] = view.store.points();
      expect(start[0]).toBeCloseTo(3.005, 6);
      expect(start[1]).toBeCloseTo(45, 6);
      expect(view.alert()).toBeNull();
    });

    it('refuses a point with no road close, says so, then forgets it', async () => {
      const view = await renderWithWays();
      await view.place(3.005, 45.003);
      expect(view.store.points()).toEqual([]);
      expect(view.alert()).toBe(
        'No road close to this place for this profile.',
      );
      await vi.advanceTimersByTimeAsync(4100);
      view.fixture.detectChanges();
      expect(view.alert()).toBeNull();
    });

    it('reads the ways of a place once, then places points at once', async () => {
      const view = await renderWithWays();
      await view.place(3.005, 45.0003);
      const read = tilesRead;
      expect(read).toBeGreaterThan(0);
      // No waiting: the ways around are known.
      view.click(3.006, 45.0003);
      expect(view.store.points()).toHaveLength(2);
      expect(view.store.points()[1][1]).toBeCloseTo(45, 6);
      expect(tilesRead).toBe(read);
    });

    it('never moves a point farther than 24 px on screen', async () => {
      const view = await renderWithWays();
      // 2 m per pixel: 24 px are 48 m, and the road is about 78 m away.
      view.driver.scale = 2;
      await view.place(3.005, 45.0007);
      expect(view.store.points()).toEqual([]);
      view.driver.scale = 10;
      await view.place(3.005, 45.0007);
      expect(view.store.points()).toHaveLength(1);
    });

    it('leaves the points of a trail run where they are placed', async () => {
      const view = await renderWithWays();
      view.store.setProfile('trail');
      view.click(3.005, 45.003);
      expect(view.store.points()).toEqual([[3.005, 45.003]]);
      expect(tilesRead).toBe(0);
    });

    it('leaves a point where it is placed when the basemap has no tile there', async () => {
      const view = await renderWithWays(null);
      await view.place(3.005, 45.003);
      expect(view.store.points()).toEqual([[3.005, 45.003]]);
      expect(view.alert()).toBeNull();
    });

    it('snaps the place picked in the map menu', async () => {
      const view = await renderWithWays();
      view.driver.handlers.onContextMenu([3.005, 45.0003], { x: 10, y: 10 });
      view.fixture.detectChanges();
      view.root.querySelector<HTMLButtonElement>('.map-menu button')?.click();
      await flush();
      expect(view.store.points()[0][1]).toBeCloseTo(45, 6);
    });

    it('puts a marker dropped away from any road back where it was', async () => {
      const view = await renderWithWays();
      await view.place(3.005, 45.0003);
      await view.place(3.015, 45.0003);
      await view.settle();
      const before = view.store.points();
      view.driver.handlers.onDragStart();
      view.driver.handlers.onMovePoint(1, [3.015, 45.004]);
      await flush();
      view.fixture.detectChanges();
      expect(view.store.dragging()).toBe(false);
      expect(view.store.points()).toEqual(before);
      expect(view.driver.cancelledDrags).toBe(1);
      expect(view.alert()).not.toBeNull();

      view.driver.handlers.onDragStart();
      view.driver.handlers.onMovePoint(1, [3.012, 45.0004]);
      await flush();
      expect(view.store.dragging()).toBe(false);
      expect(view.store.points()[1][0]).toBeCloseTo(3.012, 6);
      expect(view.store.points()[1][1]).toBeCloseTo(45, 6);
    });

    it('keeps the route on the last place with a road while a marker is dragged', async () => {
      const view = await renderWithWays();
      await view.place(3.005, 45.0003);
      await view.place(3.015, 45.0003);
      await view.settle();
      const count = requests.length;
      view.driver.handlers.onDragStart();
      view.driver.handlers.onDragPoint(1, [3.016, 45.004]);
      await vi.advanceTimersByTimeAsync(LIVE_DRAG_INTERVAL_MS + 10);
      // Away from the road: nothing is asked.
      expect(requests).toHaveLength(count);
      view.driver.handlers.onDragPoint(1, [3.016, 45.0002]);
      await vi.advanceTimersByTimeAsync(LIVE_DRAG_INTERVAL_MS + 10);
      expect(requests).toHaveLength(count + 1);
      const last = requests.at(-1)!.points.at(-1) as {
        lon: number;
        lat: number;
      };
      expect(last.lon).toBeCloseTo(3.016, 6);
      expect(last.lat).toBeCloseTo(45, 6);
    });

    it('shows the ghost of the next point where it will land', async () => {
      const view = await renderWithWays();
      // The ways are not read yet: the ghost stays under the pointer, and they get read.
      expect(view.driver.handlers.ghostAt([3.005, 45.0003])).toEqual({
        point: [3.005, 45.0003],
        refused: false,
      });
      await flush();
      const near = view.driver.handlers.ghostAt([3.005, 45.0003]);
      expect(near.refused).toBe(false);
      expect(near.point[1]).toBeCloseTo(45, 6);
      expect(view.driver.handlers.ghostAt([3.005, 45.003])).toEqual({
        point: [3.005, 45.003],
        refused: true,
      });
    });
  });

  it('detaches from the map when destroyed', async () => {
    const view = await render();
    view.fixture.destroy();
    expect(view.driver.destroyed).toBe(true);
  });

  it('detaches a driver that finishes loading after the component was destroyed', async () => {
    const fixture = TestBed.createComponent(Planner);
    fixture.detectChanges();
    fixture.destroy();
    await flush();
    await flush();
    expect(drivers.every((driver) => driver.destroyed)).toBe(true);
  });
});
