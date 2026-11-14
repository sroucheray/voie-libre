import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { createApiClient } from '@voie-libre/api-client';
import { provideInMemoryRouteStore } from '../../testing/in-memory-route-store';
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

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    calls = [];
    await TestBed.configureTestingModule({
      providers: [
        provideTestTransloco(),
        provideRouter([
          { path: 'r', component: RouteLinkPage },
          { path: '', children: [] },
        ]),
        provideInMemoryRouteStore(),
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              calls.push(`${request.method} ${new URL(request.url).pathname}`);
              return new Response('{}', { status: 500 });
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

  it('puts the points in the planner as unsaved work, and clears the link from the address', async () => {
    await open(encodeRouteLink(link));
    const planner = TestBed.inject(PlannerStore);
    expect(planner.points()).toEqual(link.points);
    expect(planner.profile()).toBe('gravel');
    expect(planner.unsaved()).toBe(true);
    expect(TestBed.inject(Location).path()).toBe('');
    // The route is computed like any itinerary: one request, no link-specific call.
    expect(calls).toEqual(['POST /route']);
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
