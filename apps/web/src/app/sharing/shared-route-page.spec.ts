import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { createApiClient } from '@voie-libre/api-client';
import {
  InMemoryRouteStore,
  provideInMemoryRouteStore,
} from '../../testing/in-memory-route-store';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import { PlannerStore } from '../planner/planner-store';
import { RoutePlanner } from '../planner/route-planner';
import { RouteStoreError } from '../storage/route-store';
import { SharedRoutePage } from './shared-route-page';

const geometry = [
  [3.087, 45.777, 402],
  [3.15, 45.65, 390],
  [3.249, 45.544, 380],
];

const shared = {
  id: 'abcdefghjk',
  name: 'Col de la Ventouse',
  profile: 'gravel',
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  geometry,
  distanceMeters: 41007,
  ascentMeters: 399,
  durationSeconds: 8674,
  createdAt: 1_700_000_000_000,
  sharedAt: 1_700_000_200_000,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('SharedRoutePage', () => {
  let calls: { method: string; path: string }[];
  let respond: () => Response;
  let routeStore: InMemoryRouteStore;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    calls = [];
    respond = () => json(shared);
    routeStore = new InMemoryRouteStore();
    await TestBed.configureTestingModule({
      providers: [
        provideTestTransloco(),
        provideRouter([{ path: 'p/:id', component: SharedRoutePage }]),
        provideInMemoryRouteStore(routeStore),
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              calls.push({
                method: request.method,
                path: new URL(request.url).pathname,
              });
              return respond();
            },
          }),
        },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
    // The planner effect is what would call POST /route when the points change.
    TestBed.inject(RoutePlanner);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function open(id = 'abcdefghjk') {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/p/${id}`);
    await vi.advanceTimersByTimeAsync(1000);
    TestBed.tick();
    harness.detectChanges();
    return harness;
  }

  const text = (harness: RouterTestingHarness) =>
    (harness.routeNativeElement as HTMLElement).textContent!.replace(
      /\s+/g,
      ' ',
    );

  it('reads the route once and shows it on the planner without computing anything', async () => {
    const harness = await open();
    const planner = TestBed.inject(PlannerStore);
    expect(calls).toEqual([{ method: 'GET', path: '/p/abcdefghjk' }]);
    expect(planner.points()).toEqual(shared.points);
    expect(planner.profile()).toBe('gravel');
    expect(planner.routes()).toHaveLength(1);
    expect(planner.routes()[0].geometry).toEqual(geometry);
    expect(planner.status()).toBe('ready');
    expect(text(harness)).toContain('Shared route');
    expect(text(harness)).toContain('Col de la Ventouse');
    expect(text(harness)).toMatch(/41(\.0)? km/);
  });

  it('keeps nothing on the device until asked', async () => {
    await open();
    expect(routeStore.records.size).toBe(0);
  });

  it('saves a copy on the device on request, under a new id and not shared', async () => {
    const harness = await open();
    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.keep')!
      .click();
    await vi.advanceTimersByTimeAsync(0);
    harness.detectChanges();
    const [saved] = [...routeStore.records.values()];
    expect(saved).toMatchObject({
      name: 'Col de la Ventouse',
      profile: 'gravel',
      points: shared.points,
      geometry,
      distanceMeters: 41007,
    });
    expect(saved.id).not.toBe('abcdefghjk');
    expect(saved.share).toBeUndefined();
    expect(text(harness)).toContain('Saved on this device.');
    expect(calls).toHaveLength(1);
  });

  it('says so when the route does not exist, in the active language', async () => {
    respond = () => json({ code: 'not_found', message: 'x' }, 404);
    const harness = await open('zzzzzzzz');
    const alert = (harness.routeNativeElement as HTMLElement).querySelector(
      '[role="alert"]',
    )!;
    expect(alert.textContent).toContain('does not exist');
    expect(TestBed.inject(PlannerStore).routes()).toEqual([]);

    TestBed.inject(LanguageService).use('fr');
    await vi.advanceTimersByTimeAsync(0);
    harness.detectChanges();
    expect(alert.textContent).toContain("n'existe pas");
  });

  it('reports an unreachable server', async () => {
    respond = () => {
      throw new TypeError('Failed to fetch');
    };
    const harness = await open();
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector(
        '[role="alert"]',
      )?.textContent,
    ).toContain('cannot be reached');
  });

  it('reports a full device when keeping the route fails', async () => {
    const harness = await open();
    routeStore.failWith = new RouteStoreError('quota');
    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.keep')!
      .click();
    await vi.advanceTimersByTimeAsync(0);
    harness.detectChanges();
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector(
        '[role="alert"]',
      )?.textContent,
    ).toContain('storage is full');
  });

  it('computes normally on the first edit after opening', async () => {
    await open();
    calls.length = 0;
    TestBed.inject(PlannerStore).movePoint(1, [3.3, 45.5]);
    TestBed.tick();
    respond = () => json({ routes: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([{ method: 'POST', path: '/route' }]);
  });
});
