import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { ElevationPanel } from './elevation-panel';
import { PlannerStore } from './planner-store';

const geometry: [number, number, number][] = Array.from(
  { length: 11 },
  (_, i) => [3, 45 + i * 0.001, 100 + i * 10],
);

async function setup(withRoute = true, surfaces?: string) {
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
  return { store, fixture, root };
}

describe('ElevationPanel', () => {
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
    const text = root.querySelector('.stretch')!.textContent!;
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
});
