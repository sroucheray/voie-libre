import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { ElevationPanel } from './elevation-panel';
import { PlannerStore } from './planner-store';

const geometry: [number, number, number][] = Array.from(
  { length: 11 },
  (_, i) => [3, 45 + i * 0.001, 100 + i * 10],
);

async function setup(withRoute = true) {
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
