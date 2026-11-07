import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import {
  FakePlannerDriver,
  provideFakePlannerDriver,
} from '../../testing/fake-planner-driver';
import { FakeMap, provideFakeMap } from '../../testing/fake-map';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { provideInMemoryRouteStore } from '../../testing/in-memory-route-store';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import { Planner } from './planner';
import { PlannerStore } from './planner-store';
import { ROUTE_DEBOUNCE_MS } from './route-planner';

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
  let requests: { points: unknown[]; profile: string; alternatives: number }[];
  let respond: (count: number) => Response;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    drivers = [];
    requests = [];
    respond = () => json(routes(1));
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: async (request) => {
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
        provideInMemoryRouteStore(),
        { provide: API_CLIENT, useValue: client },
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
    expect(view.root.querySelector('.help-bar')?.getAttribute('role')).toBe(
      'status',
    );
  });

  describe('loop', () => {
    it('offers to close the loop on the start marker from two points on', async () => {
      const view = await render();
      view.click(3.087, 45.777);
      TestBed.tick();
      expect(view.driver.markers[0].closable).toBeUndefined();
      view.click(3.249, 45.544);
      TestBed.tick();
      expect(view.driver.markers[0].closable).toBe('Close the loop');
      expect(view.driver.markers[1].closable).toBeUndefined();
    });

    it('asks how to close the loop, with only "back to the start" available', async () => {
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
      expect(choices.map((c) => c.disabled)).toEqual([false, true, true]);
      expect(choices[1].textContent).toContain('Soon');
      choices[0].click();
      view.fixture.detectChanges();
      expect(TestBed.inject(PlannerStore).isLoop()).toBe(true);
      expect(view.root.querySelector('.loop-dialog')).toBeNull();
      expect(view.root.querySelector('.loop')).toBeNull();
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

  it('shows a ghost that says what the next click creates', async () => {
    const view = await render();
    TestBed.tick();
    expect(view.driver.ghost).toEqual({
      role: 'start',
      label: 'A',
      text: 'Click to set the start',
    });
    view.click(3.087, 45.777);
    TestBed.tick();
    expect(view.driver.ghost?.role).toBe('end');
    view.click(3.249, 45.544);
    view.click(3.2, 45.6);
    TestBed.tick();
    expect(view.driver.ghost).toEqual({
      role: 'waypoint',
      label: '2',
      text: 'Click to add a stop',
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

  it('links the elevation profile and the map: hovering one moves the dot on the other', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.249, 45.544);
    await view.settle();
    expect(
      view.root.querySelector('vl-elevation-panel .profile'),
    ).not.toBeNull();
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
    const trail = Array.from(
      view.root.querySelectorAll<HTMLInputElement>('input[type=radio]'),
    ).find((input) => input.value === 'trail')!;
    trail.click();
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

    view.driver.handlers.onSelectRoute(1);
    view.fixture.detectChanges();
    TestBed.tick();
    expect(view.driver.selected).toBe(1);
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

  it('removes a point from the panel or with the map handler', async () => {
    const view = await render();
    view.click(3.087, 45.777);
    view.click(3.15, 45.65);
    view.click(3.249, 45.544);
    expect(view.root.querySelectorAll('.points li')).toHaveLength(3);
    const remove = view.root.querySelector(
      '.points li:nth-child(2) button',
    ) as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove Waypoint 1');
    remove.click();
    view.fixture.detectChanges();
    expect(view.root.querySelectorAll('.points li')).toHaveLength(2);
    view.driver.handlers.onRemovePoint(0);
    view.fixture.detectChanges();
    expect(view.root.querySelectorAll('.points li')).toHaveLength(1);
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
    expect(view.root.querySelector('.points')).toBeNull();
    expect(view.text()).toContain('Click the map to set the start.');
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
    expect(view.text()).toContain('Départ');
    expect(view.driver.markers[0].ariaLabel).toBe('Départ');
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
