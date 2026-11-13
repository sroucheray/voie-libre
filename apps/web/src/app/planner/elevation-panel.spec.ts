import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { DESCENT_COLOURS_KEY } from './descent-colours';
import { ElevationPanel } from './elevation-panel';
import { PlannerStore } from './planner-store';

const geometry: [number, number, number][] = Array.from(
  { length: 11 },
  (_, i) => [3, 45 + i * 0.001, 100 + i * 10],
);

async function setup(withRoute = true, surfaces?: string, open = true) {
  TestBed.configureTestingModule({ providers: [provideTestTransloco()] });
  TestBed.inject(LanguageService).use('en');
  const store = TestBed.inject(PlannerStore);
  if (withRoute) {
    store.setRoutes([
      {
        geometry,
        distanceMeters: 1110,
        ascentMeters: 100,
        durationSeconds: 300,
        ...(surfaces === undefined ? {} : { surfaces }),
      },
    ]);
  }
  const fixture = TestBed.createComponent(ElevationPanel);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  // It starts folded: most tests look at the open profile.
  if (open && withRoute) {
    root.querySelector<HTMLButtonElement>('header button')?.click();
    await fixture.whenStable();
  }
  return { store, fixture, root };
}

describe('ElevationPanel', () => {
  beforeEach(() => localStorage.removeItem(DESCENT_COLOURS_KEY));
  afterEach(() => localStorage.removeItem(DESCENT_COLOURS_KEY));

  it('shows nothing without a route', async () => {
    const { root } = await setup(false);
    expect(root.querySelector('.profile')).toBeNull();
  });

  it('draws the profile with its elevation range', async () => {
    const { root } = await setup();
    expect(root.querySelector('path.line')).not.toBeNull();
    expect(root.querySelector('.axis')?.textContent).toContain('200');
    expect(root.querySelector('.axis')?.textContent).toContain('100');
  });

  it('moves the cursor with the arrow keys and shows distance, elevation and grade', async () => {
    const { store, fixture, root } = await setup();
    const plot = root.querySelector<HTMLElement>('.plot')!;
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    await fixture.whenStable();
    expect(store.cursor()).toBe(10);
    const tooltip = root.querySelector('.tooltip')!.textContent!;
    expect(tooltip).toContain('200');
    expect(tooltip).toContain('%');

    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(store.cursor()).toBeNull();
    expect(root.querySelector('.tooltip')).toBeNull();
  });

  it('puts the cursor where the pointer is and clears it on leave', async () => {
    const { store, fixture, root } = await setup();
    const plot = root.querySelector<HTMLElement>('.plot')!;
    plot.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 100 }) as DOMRect;
    plot.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 100, bubbles: true }),
    );
    expect(store.cursor()).toBe(5);
    plot.dispatchEvent(new PointerEvent('pointerleave'));
    expect(store.cursor()).toBeNull();
  });

  it('shows what the route rides on under the chart, with the share of each', async () => {
    // Ten segments of about 111 m: 6 paved, 3 unpaved, 1 path.
    const { root } = await setup(true, 'pppppp' + 'uuu' + 's');
    const runs = [...root.querySelectorAll<HTMLElement>('.surface__run')];
    expect(runs).toHaveLength(3);
    // The first run is 60 % of the distance, from the start.
    expect(runs[0].style.left).toBe('0%');
    expect(parseFloat(runs[0].style.width)).toBeCloseTo(60, 0);
    const legend = [...root.querySelectorAll('.surface-legend li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(legend).toHaveLength(3);
    expect(legend[0]).toMatch(/^Paved 60 % \(/);
    expect(legend[1]).toMatch(/^Unpaved or rough 30 % \(/);
    expect(legend[2]).toMatch(/^Path 10 % \(/);
  });

  it('offers to calculate the surface of a route that does not say, and the button asks for it', async () => {
    const { store, fixture, root } = await setup(true);
    store.loadSaved({
      points: [
        [3, 45],
        [3, 45.01],
      ],
      profile: 'road',
      geometry,
      distanceMeters: 1110,
      ascentMeters: 100,
      durationSeconds: 300,
    });
    await fixture.whenStable();
    const note = root.querySelector('.surface-missing')!;
    expect(note.textContent).toContain('no surface information');
    const before = store.recomputeCount();
    note.querySelector('button')!.click();
    expect(store.recomputeCount()).toBe(before + 1);
  });

  it('says a loop from a place to itself cannot be calculated again, with no button', async () => {
    const { store, fixture, root } = await setup(true);
    store.loadSaved({
      points: [
        [3, 45],
        [3, 45],
      ],
      profile: 'road',
      geometry,
      distanceMeters: 1110,
      ascentMeters: 100,
      durationSeconds: 300,
    });
    await fixture.whenStable();
    const note = root.querySelector('.surface-missing')!;
    expect(note.textContent).toContain('cannot be calculated again');
    expect(note.querySelector('button')).toBeNull();
  });

  it('shows no surface bar for a route that does not say, or whose codes do not fit', async () => {
    expect((await setup(true)).root.querySelector('.surface')).toBeNull();
    TestBed.resetTestingModule();
    const { root } = await setup(true, 'ppp');
    expect(root.querySelector('.surface')).toBeNull();
    expect(root.querySelector('.surface-legend')).toBeNull();
  });

  it('colours the chart by grade and explains the colours', async () => {
    const { root } = await setup();
    expect(root.querySelectorAll('path.area').length).toBeGreaterThan(0);
    // 10 m up every 111 m is about 9 %: the third band.
    expect(root.querySelector('path.area--2')).not.toBeNull();
    expect(root.querySelectorAll('.legend li')).toHaveLength(5);
    expect(root.querySelector('.legend')?.textContent).toContain('3–6 %');
  });

  it('selects a stretch by dragging and shows what it adds up to', async () => {
    const { store, fixture, root } = await setup();
    const plot = root.querySelector<HTMLElement>('.plot')!;
    plot.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 100 }) as DOMRect;
    const pointer = (type: string, clientX: number) =>
      plot.dispatchEvent(
        new PointerEvent(type, { clientX, button: 0, bubbles: true }),
      );

    pointer('pointerdown', 120);
    pointer('pointermove', 40);
    pointer('pointerup', 40);
    await fixture.whenStable();

    expect(store.stretch()).toEqual({ from: 2, to: 6 });
    expect(root.querySelector('.selection')).not.toBeNull();
    const text = root.querySelector('.bubble')!.textContent!;
    expect(text).toContain('445 m');
    expect(text).toContain('↑ 40 m');
    expect(text).toContain('↓ 0 m');
    expect(text).toContain('9.0 %');

    // Moving without pressing keeps it; a click lets it go.
    pointer('pointermove', 180);
    expect(store.stretch()).toEqual({ from: 2, to: 6 });
    pointer('pointerdown', 180);
    pointer('pointerup', 180);
    await fixture.whenStable();
    expect(store.stretch()).toBeNull();
    expect(root.querySelector('.selection')).toBeNull();
  });

  it('offers to zoom the map on the selected stretch, only once there is one, and never by itself', async () => {
    const { store, fixture, root } = await setup();
    expect(root.querySelector('.bubble')).toBeNull();
    store.selectStretch([2, 6]);
    await fixture.whenStable();
    // Selecting does not move the map.
    expect(store.viewRequest()).toBeNull();
    const button = root.querySelector<HTMLButtonElement>('.bubble__zoom')!;
    expect(button.title).toBe('Zoom on the map');
    expect(button.getAttribute('aria-label')).toBe(
      'Zoom the map on the selected stretch',
    );
    button.click();
    // The map is asked to glide to the vertices 2 to 6 of the route.
    expect(store.viewRequest()?.animate).toBe(true);
    expect(store.viewRequest()?.geometry).toEqual(geometry.slice(2, 7));
    // Letting the selection go removes the button and does not move the map again.
    const id = store.viewRequest()!.id;
    store.selectStretch(null);
    await fixture.whenStable();
    expect(root.querySelector('.bubble')).toBeNull();
    expect(store.viewRequest()?.id).toBe(id);
  });

  it('puts the bubble by the selection, leaning on the edge near the ends, and keeps it out of the selection', async () => {
    const { store, fixture, root } = await setup();
    store.selectStretch([4, 6]);
    await fixture.whenStable();
    const bubble = () => root.querySelector<HTMLElement>('.bubble')!;
    expect(bubble().classList.contains('bubble--start')).toBe(false);
    expect(bubble().classList.contains('bubble--end')).toBe(false);
    expect(bubble().style.left).toBe('50%');
    store.selectStretch([0, 2]);
    await fixture.whenStable();
    expect(bubble().classList.contains('bubble--start')).toBe(true);
    store.selectStretch([8, 10]);
    await fixture.whenStable();
    expect(bubble().classList.contains('bubble--end')).toBe(true);
    // A press on the bubble does not reach the chart: it neither starts nor ends a selection.
    bubble().dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, bubbles: true }),
    );
    bubble().dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(store.stretch()).toEqual({ from: 8, to: 10 });
  });

  describe('descent colours', () => {
    // Up, then down: one run of climbs, one of descents.
    const hill: [number, number, number][] = Array.from(
      { length: 11 },
      (_, i) => [3, 45 + i * 0.001, 100 + (i <= 5 ? i : 10 - i) * 20],
    );
    const bands = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('path.area')).map((path) =>
        path.getAttribute('class'),
      );

    it('leaves the descents neutral on road and colours them on trail, with a switch for each profile', async () => {
      const { store, fixture, root } = await setup();
      store.setRoutes([
        {
          geometry: hill,
          distanceMeters: 1110,
          ascentMeters: 100,
          durationSeconds: 300,
        },
      ]);
      await fixture.whenStable();
      const switchBox = () =>
        root.querySelector<HTMLInputElement>('.descents input')!;
      expect(switchBox().checked).toBe(false);
      // Steep climbs keep their colour; the descent takes the flat one.
      expect(bands(root)[0]).toBe('area area--4');
      expect(bands(root).at(-1)).toBe('area area--0');
      const roadBands = bands(root);
      store.setProfile('trail');
      await fixture.whenStable();
      expect(switchBox().checked).toBe(true);
      expect(bands(root)).not.toEqual(roadBands);
      // The choice is for the profile: turning it off on trail leaves road as it was.
      switchBox().click();
      await fixture.whenStable();
      expect(bands(root)).toEqual(roadBands);
      store.setProfile('road');
      await fixture.whenStable();
      expect(switchBox().checked).toBe(false);
    });
  });

  it('selects with Shift and the arrow keys, and Escape clears', async () => {
    const { store, fixture, root } = await setup();
    const plot = root.querySelector<HTMLElement>('.plot')!;
    const key = (name: string, shiftKey = false) =>
      plot.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey }));
    key('Home');
    key('ArrowRight', true);
    key('ArrowRight', true);
    expect(store.stretch()).toEqual({ from: 0, to: 2 });

    key('Escape');
    await fixture.whenStable();
    expect(store.stretch()).toBeNull();
  });

  it('drops the stretch when the route changes', async () => {
    const { store } = await setup();
    store.selectStretch([1, 4]);
    expect(store.stretch()).toEqual({ from: 1, to: 4 });
    store.setRoutes([
      {
        geometry: geometry.slice(0, 6),
        distanceMeters: 555,
        ascentMeters: 50,
        durationSeconds: 150,
      },
    ]);
    expect(store.stretch()).toBeNull();
  });

  it('collapses and expands', async () => {
    const { fixture, root } = await setup();
    root.querySelector<HTMLButtonElement>('header button')!.click();
    await fixture.whenStable();
    expect(root.querySelector('.plot')).toBeNull();
    root.querySelector<HTMLButtonElement>('header button')!.click();
    await fixture.whenStable();
    expect(root.querySelector('.plot')).not.toBeNull();
  });

  it('shows the curve in the header while folded, and not when open', async () => {
    const { fixture, root } = await setup();
    expect(root.querySelector('vl-profile-mini')).toBeNull();
    root.querySelector<HTMLButtonElement>('header button')!.click();
    await fixture.whenStable();
    expect(
      root.querySelector('header vl-profile-mini .mini svg'),
    ).not.toBeNull();
    expect(root.querySelector('vl-profile-mini .mini p')).toBeNull();
    root.querySelector<HTMLButtonElement>('header button')!.click();
    await fixture.whenStable();
    expect(root.querySelector('vl-profile-mini')).toBeNull();
  });
});
