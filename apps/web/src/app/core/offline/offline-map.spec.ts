import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { PlannerStore } from '../../planner/planner-store';
import { LanguageService } from '../i18n/language.service';
import { MapViewport } from '../map/map-viewport';
import {
  OfflineBasemap,
  type AreaPlan,
  type AreaShape,
  type OfflineArea,
  type OfflineState,
} from './offline-basemap';
import { OfflineMap } from './offline-map';

type ErrorCode = 'unsupported' | 'network' | 'quota' | 'too_big' | 'unknown';

class FakeOffline {
  state = signal<OfflineState>('idle');
  progress = signal(0);
  downloadedBytes = signal(0);
  totalBytes = signal(0);
  errorCode = signal<ErrorCode | null>(null);
  areas = signal<OfflineArea[]>([]);
  pending = signal<AreaPlan | null>(null);
  calls: unknown[] = [];
  plan(shape: AreaShape) {
    this.calls.push(['plan', shape]);
  }
  keep(name: string) {
    this.calls.push(['keep', name]);
  }
  discard() {
    this.calls.push('discard');
  }
  cancel() {
    this.calls.push('cancel');
  }
  removeArea(id: string) {
    this.calls.push(['removeArea', id]);
  }
}

const area = (id: string, name: string, bytes: number): OfflineArea => ({
  id,
  name,
  kind: 'route',
  box: [3, 45, 3.1, 45.1],
  tiles: 100,
  bytes,
  createdAt: 0,
  relief: true,
});

describe('OfflineMap', () => {
  let offline: FakeOffline;

  beforeEach(async () => {
    localStorage.clear();
    offline = new FakeOffline();
    await TestBed.configureTestingModule({
      imports: [OfflineMap],
      providers: [
        provideTestTransloco(),
        { provide: OfflineBasemap, useValue: offline },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  function render() {
    const fixture = TestBed.createComponent(OfflineMap);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      update: async () => {
        TestBed.tick();
        await fixture.whenStable();
        fixture.detectChanges();
      },
      text: () => root.textContent!.replace(/\s+/g, ' ').trim(),
      button: (selector: string) =>
        root.querySelector<HTMLButtonElement>(selector)!,
    };
  }

  const showRoute = () =>
    TestBed.inject(PlannerStore).setRoutes([
      {
        geometry: [
          [3.0, 45.0, 0],
          [3.1, 45.1, 0],
        ],
        distanceMeters: 41_000,
        ascentMeters: 100,
        durationSeconds: 100,
      },
    ]);

  it('offers the view only until a route is on screen, and the view needs a map', async () => {
    const view = render();
    await view.update();
    expect(view.button('.keep-route').disabled).toBe(true);
    expect(view.button('.keep-view').disabled).toBe(true);
    TestBed.inject(MapViewport).box.set([3, 45, 3.1, 45.1]);
    showRoute();
    await view.update();
    expect(view.button('.keep-route').disabled).toBe(false);
    expect(view.button('.keep-view').disabled).toBe(false);
  });

  it('asks to keep the corridor of the route, named after it, then waits for the yes', async () => {
    showRoute();
    const view = render();
    await view.update();
    view.button('.keep-route').click();
    expect(offline.calls).toEqual([
      [
        'plan',
        {
          kind: 'route',
          line: [
            [3.0, 45.0],
            [3.1, 45.1],
          ],
        },
      ],
    ]);
    // The service estimates, then the user sees what it takes.
    offline.pending.set({
      shape: { kind: 'route', line: [] },
      tiles: Array.from({ length: 3912 }, () => ({ z: 14, x: 0, y: 0 })),
      reliefTiles: [],
      bytes: 148_000_000,
      fits: true,
    });
    await view.update();
    expect(view.text()).toContain('About 148 MB for 3,912 tiles.');
    expect(view.button('.keep-route').disabled).toBe(true);
    view.button('.confirm').click();
    const keep = offline.calls.at(-1) as [string, string];
    expect(keep[0]).toBe('keep');
    expect(keep[1]).toMatch(/^Route 41 km, /);
    view.button('.discard').click();
    expect(offline.calls.at(-1)).toBe('discard');
  });

  it('asks to keep the view on screen', async () => {
    TestBed.inject(MapViewport).box.set([3, 45, 3.1, 45.1]);
    const view = render();
    await view.update();
    view.button('.keep-view').click();
    expect(offline.calls).toEqual([
      ['plan', { kind: 'view', box: [3, 45, 3.1, 45.1] }],
    ]);
  });

  it('does not let the user confirm an area that does not fit', async () => {
    offline.pending.set({
      shape: { kind: 'view', box: [0, 0, 1, 1] },
      tiles: [{ z: 0, x: 0, y: 0 }],
      reliefTiles: [],
      bytes: 5_000_000_000,
      fits: false,
    });
    const view = render();
    await view.update();
    expect(view.button('.confirm').disabled).toBe(true);
    expect(view.root.querySelector('[role="alert"]')?.textContent).toContain(
      'Not enough storage space',
    );
  });

  it('shows the estimate and a cancel button while it estimates', async () => {
    offline.state.set('planning');
    const view = render();
    await view.update();
    expect(view.text()).toContain('Estimating the size');
    view.button('.cancel').click();
    expect(offline.calls).toEqual(['cancel']);
  });

  it('shows the progress and a cancel button while downloading', async () => {
    offline.state.set('downloading');
    offline.progress.set(0.5);
    offline.downloadedBytes.set(20_000_000);
    offline.totalBytes.set(40_000_000);
    const view = render();
    await view.update();
    expect(view.root.querySelector('progress')!.value).toBe(50);
    expect(view.text()).toContain('20 MB of about 40 MB');
    view.button('.cancel').click();
    expect(offline.calls).toEqual(['cancel']);
  });

  it('lists the areas kept, each with its size and a remove button', async () => {
    offline.areas.set([
      area('a', 'Route 41 km', 148_000_000),
      area('b', 'View', 12_000_000),
    ]);
    const view = render();
    await view.update();
    const items = [...view.root.querySelectorAll('.areas li')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Route 41 km');
    expect(items[0].textContent).toContain('148 MB');
    items[1].querySelector<HTMLButtonElement>('.remove')!.click();
    expect(offline.calls).toEqual([['removeArea', 'b']]);
    expect(items[1].querySelector('.remove')!.getAttribute('aria-label')).toBe(
      'Remove View from the device',
    );
  });

  it.each([
    ['unsupported', 'cannot keep the map offline', 'ne peut pas garder'],
    ['network', 'could not be downloaded', "n'a pas pu être téléchargée"],
    ['quota', 'Not enough storage space', 'Pas assez'],
    ['too_big', 'too big', 'trop grande'],
    ['unknown', 'could not be saved', "n'a pas pu être enregistrée"],
  ] as const)('translates the %s error', async (code, english, french) => {
    offline.errorCode.set(code);
    const view = render();
    await view.update();
    expect(view.root.querySelector('[role="alert"]')?.textContent).toContain(
      english,
    );
    TestBed.inject(LanguageService).use('fr');
    await view.update();
    await view.update();
    expect(view.root.querySelector('[role="alert"]')?.textContent).toContain(
      french,
    );
  });
});
