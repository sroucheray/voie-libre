import { Location } from '@angular/common';
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
import { encodeRouteLink, type RouteLink } from './route-link';
import { RouteLinkPage } from './route-link-page';

const link: RouteLink = {
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  profile: 'gravel',
  loop: null,
  name: 'Clermont to Issoire',
};

describe('RouteLinkPage', () => {
  let calls: string[];
  let routeStore: InMemoryRouteStore;
  let respond: () => Response;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    calls = [];
    routeStore = new InMemoryRouteStore();
    respond = () => new Response('{}', { status: 500 });
    await TestBed.configureTestingModule({
      providers: [
        provideTestTransloco(),
        provideRouter([
          { path: 'r', component: RouteLinkPage },
          { path: '', children: [] },
        ]),
        provideInMemoryRouteStore(routeStore),
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              calls.push(`${request.method} ${new URL(request.url).pathname}`);
              return respond();
            },
          }),
        },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
    TestBed.inject(RoutePlanner);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function open(fragment: string) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/r#${fragment}`);
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

  it('puts the points in the planner as unsaved work and asks what to do with the route', async () => {
    const harness = await open(encodeRouteLink(link));
    const planner = TestBed.inject(PlannerStore);
    expect(planner.points()).toEqual(link.points);
    expect(planner.profile()).toBe('gravel');
    expect(planner.unsaved()).toBe(true);
    expect(text(harness)).toContain('A route was shared with you');
    expect(text(harness)).toContain('Clermont to Issoire');
    // The route is computed like any itinerary: one request, no link-specific call.
    expect(calls).toEqual(['POST /route']);
  });

  it('waits for the route before offering to save or export it, and says when it failed', async () => {
    const harness = await open(encodeRouteLink(link));
    const root = harness.routeNativeElement as HTMLElement;
    // The test server answers the calculation with an error.
    expect(text(harness)).toContain('could not be calculated');
    expect(root.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.export-gpx')!.disabled).toBe(
      true,
    );
    expect(root.querySelector<HTMLButtonElement>('.show')!.disabled).toBe(
      false,
    );
  });

  it('saves the calculated route under the name of the link, or exports it, once it is there', async () => {
    respond = () =>
      new Response(
        JSON.stringify({
          routes: [
            {
              geometry: [
                [3.087, 45.777, 402],
                [3.249, 45.544, 380],
              ],
              distanceMeters: 41007,
              ascentMeters: 399,
              durationSeconds: 8674,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const harness = await open(encodeRouteLink(link));
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(
      false,
    );
    expect(root.querySelector<HTMLButtonElement>('.export-gpx')!.disabled).toBe(
      false,
    );
    root.querySelector<HTMLButtonElement>('.save')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const [saved] = [...routeStore.records.values()];
    expect(saved).toMatchObject({
      name: 'Clermont to Issoire',
      profile: 'gravel',
      points: link.points,
      distanceMeters: 41007,
    });
    expect(TestBed.inject(PlannerStore).savedAs()?.id).toBe(saved.id);
    expect(TestBed.inject(Location).path()).toBe('');
  });

  it('replaces the dialog when another link is opened while it is still there', async () => {
    const harness = await open(encodeRouteLink(link));
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('dialog'),
    ).not.toBeNull();
    // Unsaved work (the first route) is on screen: the second link asks before replacing it.
    await harness.navigateByUrl(
      `/r#${encodeRouteLink({ ...link, name: 'Second' })}`,
    );
    await vi.advanceTimersByTimeAsync(10);
    TestBed.tick();
    harness.detectChanges();
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('dialog'),
    ).toBeNull();
    expect(text(harness)).toContain('replaces the route on screen');
  });

  it('goes back to the planner, with the link gone from the address, once answered', async () => {
    const harness = await open(encodeRouteLink(link));
    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.show')!
      .click();
    await vi.advanceTimersByTimeAsync(0);
    expect(TestBed.inject(Location).path()).toBe('');
    expect(TestBed.inject(PlannerStore).points()).toEqual(link.points);
  });

  it('asks before replacing unsaved work, and keeps it when told to', async () => {
    const planner = TestBed.inject(PlannerStore);
    planner.setStart([2, 46]);
    planner.setEnd([2.1, 46.1]);
    const harness = await open(encodeRouteLink(link));
    expect(text(harness)).toContain('replaces the route on screen');
    expect(planner.points()).toEqual([
      [2, 46],
      [2.1, 46.1],
    ]);
    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.keep')!
      .click();
    await vi.advanceTimersByTimeAsync(0);
    expect(planner.points()).toEqual([
      [2, 46],
      [2.1, 46.1],
    ]);
    expect(TestBed.inject(Location).path()).toBe('');
  });

  it('replaces unsaved work once the person agrees', async () => {
    const planner = TestBed.inject(PlannerStore);
    planner.setStart([2, 46]);
    planner.setEnd([2.1, 46.1]);
    const harness = await open(encodeRouteLink(link));
    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.replace')!
      .click();
    await vi.advanceTimersByTimeAsync(0);
    expect(planner.points()).toEqual(link.points);
  });

  it.each([
    ['', 'does not carry a route'],
    ['v=2&p=road&c=abc', 'newer version'],
    ['v=1&p=road&c=ab!d', 'damaged or incomplete'],
  ])('shows why a link cannot be read: %j', async (fragment, message) => {
    const harness = await open(fragment);
    expect(text(harness)).toContain(message);
    expect(TestBed.inject(PlannerStore).points()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
