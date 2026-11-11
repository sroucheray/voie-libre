import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { FakeMap, provideFakeMap } from '../../../testing/fake-map';
import { LanguageService } from '../i18n/language.service';
import { BASEMAP_URL, LngLat, MAP_FACTORY } from './map-factory';
import { MAP_LAYERS_KEY } from './map-layers';
import { MapView } from './map-view';

/** The factory and MapLibre events are asynchronous and not tracked by whenStable. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('MapView', () => {
  let maps: FakeMap[];

  beforeEach(async () => {
    localStorage.clear();
    maps = [];
    await TestBed.configureTestingModule({
      imports: [MapView],
      providers: [
        provideTestTransloco(),
        provideFakeMap(maps),
        { provide: BASEMAP_URL, useValue: 'http://tiles.test' },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  async function render() {
    const fixture = TestBed.createComponent(MapView);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return fixture;
  }

  const buttons = (fixture: { nativeElement: HTMLElement }) =>
    Array.from(fixture.nativeElement.querySelectorAll('button'));

  it('creates the map on Clermont-Ferrand at zoom 11 over the local basemap', async () => {
    await render();
    expect(maps).toHaveLength(1);
    expect(maps[0].options.center).toEqual([3.087, 45.777]);
    expect(maps[0].options.zoom).toBe(11);
    expect(maps[0].options.style.sources['protomaps']).toMatchObject({
      url: 'pmtiles://http://tiles.test/clermont.pmtiles',
    });
  });

  it('starts from the configured view', async () => {
    @Component({
      imports: [MapView],
      template: '<vl-map-view [(center)]="center" [(zoom)]="zoom" />',
    })
    class Host {
      center = signal<LngLat>([2.5, 45.2]);
      zoom = signal(9);
    }
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flush();
    expect(maps[0].options.center).toEqual([2.5, 45.2]);
    expect(maps[0].options.zoom).toBe(9);
  });

  it('exposes the map view as signals that follow the user', async () => {
    const fixture = await render();
    maps[0].center = { lng: 3.2, lat: 45.6 };
    maps[0].zoom = 13.5;
    maps[0].emit('moveend');
    expect(fixture.componentInstance.center()).toEqual([3.2, 45.6]);
    expect(fixture.componentInstance.zoom()).toBe(13.5);
    expect(maps[0].calls).not.toContain('jumpTo');
  });

  it('moves the map when center and zoom are written', async () => {
    const fixture = await render();
    fixture.componentInstance.center.set([3.5, 45.9]);
    fixture.componentInstance.zoom.set(14);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(maps[0].calls).toContain('jumpTo');
    expect(maps[0].center).toEqual({ lng: 3.5, lat: 45.9 });
    expect(maps[0].zoom).toBe(14);
  });

  it('removes the map when destroyed', async () => {
    const fixture = await render();
    fixture.destroy();
    expect(maps[0].removed).toBe(true);
  });

  it('removes a map that finishes loading after the component was destroyed', async () => {
    const fixture = TestBed.createComponent(MapView);
    fixture.detectChanges();
    fixture.destroy();
    await flush();
    expect(maps).toHaveLength(1);
    expect(maps[0].removed).toBe(true);
  });

  it('zooms with the buttons, labelled for assistive technology', async () => {
    const fixture = await render();
    const [zoomIn, zoomOut] = buttons(fixture);
    expect(zoomIn.getAttribute('aria-label')).toBe('Zoom in');
    expect(zoomOut.getAttribute('aria-label')).toBe('Zoom out');
    zoomIn.click();
    zoomOut.click();
    expect(maps[0].calls).toEqual(['zoomIn', 'zoomOut']);
  });

  it('shows the compass only when the map is rotated, and resets north', async () => {
    const fixture = await render();
    // Zoom in, zoom out and the layers.
    expect(buttons(fixture)).toHaveLength(3);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.compass'),
    ).toBeNull();
    maps[0].bearing = 40;
    maps[0].emit('rotate');
    fixture.detectChanges();
    const compass = buttons(fixture)[2];
    expect(compass.getAttribute('aria-label')).toBe('Reset the map to north');
    compass.click();
    expect(maps[0].calls).toContain('resetNorth');
  });

  it('names map labels in the UI language and restyles when it changes', async () => {
    await render();
    expect(JSON.stringify(maps[0].options.style.layers)).toContain('name:en');
    expect(maps[0].calls).not.toContain('setStyle');
    TestBed.inject(LanguageService).use('fr');
    await flush();
    expect(maps[0].calls).toContain('setStyle');
    expect(JSON.stringify(maps[0].style)).toContain('name:fr');
  });

  describe('layers', () => {
    /** Configures the tests again, with or without the file of relief tiles on the server. */
    async function renderWith(relief: boolean) {
      TestBed.resetTestingModule();
      maps = [];
      await TestBed.configureTestingModule({
        imports: [MapView],
        providers: [
          provideTestTransloco(),
          provideFakeMap(maps, { relief }),
          { provide: BASEMAP_URL, useValue: 'http://tiles.test' },
        ],
      }).compileComponents();
      TestBed.inject(LanguageService).init();
      const fixture = await render();
      await flush();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const button = root.querySelector<HTMLButtonElement>('.layers-button')!;
      return {
        fixture,
        root,
        button,
        open() {
          button.click();
          fixture.detectChanges();
        },
        checkbox: () =>
          root.querySelector<HTMLInputElement>('.layers-panel input'),
        sources: () =>
          Object.keys(
            (maps[0].style as { sources: object } | undefined)?.sources ??
              maps[0].options.style.sources,
          ),
      };
    }

    it('shows the relief by default once its tiles are known to exist', async () => {
      const view = await renderWith(true);
      // The map does not wait for the relief: it is created without, then restyled.
      expect(Object.keys(maps[0].options.style.sources)).toEqual(['protomaps']);
      expect(view.sources()).toEqual(['protomaps', 'relief']);
      expect(
        view.root.querySelector('.map-attribution')?.textContent,
      ).toContain('Relief: Copernicus');
    });

    it('opens a panel where the relief is turned off and on, and keeps the choice', async () => {
      const view = await renderWith(true);
      expect(view.button.getAttribute('aria-expanded')).toBe('false');
      expect(view.checkbox()).toBeNull();
      view.open();
      expect(view.button.getAttribute('aria-expanded')).toBe('true');
      expect(view.checkbox()?.checked).toBe(true);

      view.checkbox()!.click();
      await flush();
      view.fixture.detectChanges();
      expect(view.sources()).toEqual(['protomaps']);
      expect(
        view.root.querySelector('.map-attribution')?.textContent,
      ).not.toContain('Copernicus');
      expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!)).toEqual({
        relief: false,
        ways: false,
        surface: false,
      });

      view.checkbox()!.click();
      await flush();
      expect(view.sources()).toEqual(['protomaps', 'relief']);
    });

    it('starts without relief when the user turned it off before', async () => {
      localStorage.setItem(MAP_LAYERS_KEY, JSON.stringify({ relief: false }));
      const view = await renderWith(true);
      expect(maps[0].calls).not.toContain('setStyle');
      view.open();
      expect(view.checkbox()?.checked).toBe(false);
      expect(view.checkbox()?.disabled).toBe(false);
    });

    it('colours the ways of the profile once asked, with a legend, and follows the profile', async () => {
      const view = await renderWith(true);
      const layerIds = () =>
        (
          (maps[0].style as { layers: { id: string }[] } | undefined)?.layers ??
          []
        ).map((l) => l.id);
      view.open();
      const ways = view.root.querySelector<HTMLInputElement>('.ways-checkbox')!;
      // No profile given: nothing to colour.
      expect(ways.disabled).toBe(true);
      view.fixture.componentRef.setInput('waysProfile', 'road');
      view.fixture.detectChanges();
      expect(ways.disabled).toBe(false);
      expect(ways.checked).toBe(false);
      expect(view.root.querySelector('.ways-legend')).toBeNull();
      expect(layerIds()).not.toContain('ways-good');

      ways.click();
      await flush();
      view.fixture.detectChanges();
      expect(layerIds()).toContain('ways-good');
      expect(
        [...view.root.querySelectorAll('.ways-legend li')].map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['Suited', 'Possible', 'To avoid']);

      // The profile changes: the layers are drawn again for it.
      const before = maps[0].calls.filter((c) => c === 'setStyle').length;
      view.fixture.componentRef.setInput('waysProfile', 'trail');
      view.fixture.detectChanges();
      await flush();
      expect(maps[0].calls.filter((c) => c === 'setStyle').length).toBe(
        before + 1,
      );

      ways.click();
      await flush();
      view.fixture.detectChanges();
      expect(layerIds()).not.toContain('ways-good');
      expect(view.root.querySelector('.ways-legend')).toBeNull();
    });

    it('offers the surface of the route, off at first, with a legend of the five categories', async () => {
      const view = await renderWith(true);
      view.open();
      const box =
        view.root.querySelector<HTMLInputElement>('.surface-checkbox')!;
      expect(box.checked).toBe(false);
      expect(view.root.querySelector('.surface-legend')).toBeNull();
      box.click();
      view.fixture.detectChanges();
      expect(
        [...view.root.querySelectorAll('.surface-legend li')].map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['Paved', 'Cycleway', 'Unpaved or rough', 'Path', 'Unknown']);
      expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!).surface).toBe(
        true,
      );
    });

    it('says why the route has no colours, and asks for them', async () => {
      const view = await renderWith(true);
      view.open();
      view.root.querySelector<HTMLInputElement>('.surface-checkbox')!.click();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.layers-action')).toBeNull();
      const asked: number[] = [];
      view.fixture.componentInstance.computeSurface.subscribe(() =>
        asked.push(1),
      );
      view.fixture.componentRef.setInput('surfaceMissing', true);
      view.fixture.detectChanges();
      const button =
        view.root.querySelector<HTMLButtonElement>('.layers-action')!;
      expect(button.closest('p')?.textContent).toContain(
        'no surface information',
      );
      button.click();
      expect(asked).toEqual([1]);
    });

    it('leaves the map as it is without the relief file, and says why', async () => {
      const view = await renderWith(false);
      expect(maps[0].calls).not.toContain('setStyle');
      view.open();
      expect(view.checkbox()?.disabled).toBe(true);
      expect(view.checkbox()?.checked).toBe(false);
      expect(view.root.querySelector('.layers-note')?.textContent).toContain(
        'Not available',
      );
    });

    it('closes the panel on Escape, giving the focus back, and on a press outside', async () => {
      const view = await renderWith(true);
      document.body.append(view.root);
      view.open();
      view.checkbox()!.focus();
      view
        .checkbox()!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      view.fixture.detectChanges();
      expect(view.checkbox()).toBeNull();
      expect(document.activeElement).toBe(view.button);

      view.open();
      view
        .checkbox()!
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));
      view.fixture.detectChanges();
      expect(view.checkbox()).not.toBeNull();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      view.fixture.detectChanges();
      expect(view.checkbox()).toBeNull();
      view.root.remove();
    });

    it('keeps the relief when the language changes', async () => {
      const view = await renderWith(true);
      TestBed.inject(LanguageService).use('fr');
      await flush();
      expect(JSON.stringify(maps[0].style)).toContain('name:fr');
      expect(view.sources()).toEqual(['protomaps', 'relief']);
    });
  });

  it('tells the user when the map cannot be created, instead of failing silently', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MapView],
      providers: [
        provideTestTransloco(),
        {
          provide: MAP_FACTORY,
          useValue: async () => {
            throw new Error('WebGL2 is required');
          },
        },
      ],
    });
    TestBed.inject(LanguageService).init();
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fixture = await render();
    const alert = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="alert"]',
    );
    expect(alert?.textContent).toContain('could not be displayed');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('credits OpenStreetMap and Protomaps, translated', async () => {
    const fixture = await render();
    const credit = (fixture.nativeElement as HTMLElement).querySelector(
      '.map-attribution',
    )!;
    expect(credit.textContent).toContain('OpenStreetMap');
    expect(credit.textContent).toContain('contributors');
    expect(credit.textContent).toContain('Protomaps');
    TestBed.inject(LanguageService).use('fr');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(credit.textContent).toContain('contributeurs');
    expect(credit.getAttribute('aria-label')).toBe(
      'Source des données cartographiques',
    );
    expect(buttons(fixture)[0].getAttribute('aria-label')).toBe('Zoom avant');
  });
});
