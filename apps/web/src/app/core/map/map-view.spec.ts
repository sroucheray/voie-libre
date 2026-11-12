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
      url: 'pmtiles://http://tiles.test/basemap.pmtiles',
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

  it('has a button for the whole route, disabled until there is one, that asks for it', async () => {
    const fixture = await render();
    const button = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('.fit-route')!;
    expect(button.getAttribute('aria-label')).toBe('Show the whole route');
    expect(button.disabled).toBe(true);
    let asked = 0;
    fixture.componentInstance.fitRoute.subscribe(() => asked++);
    fixture.componentRef.setInput('canFitRoute', true);
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    button.click();
    expect(asked).toBe(1);
  });

  it('shows the compass only when the map is rotated, and resets north', async () => {
    const fixture = await render();
    // Zoom in, zoom out, the whole route and the layers.
    expect(buttons(fixture)).toHaveLength(4);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.compass'),
    ).toBeNull();
    maps[0].bearing = 40;
    maps[0].emit('rotate');
    fixture.detectChanges();
    const compass = buttons(fixture)[3];
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
    async function renderWith(
      relief: boolean,
      coverage: [number, number, number, number] | null = null,
      reliefKind: 'local' | 'public' = 'local',
    ) {
      TestBed.resetTestingModule();
      maps = [];
      await TestBed.configureTestingModule({
        imports: [MapView],
        providers: [
          provideTestTransloco(),
          provideFakeMap(maps, { relief, coverage, reliefKind }),
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
        ways: true,
        surface: true,
        imagery: false,
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

    it('colours the ways of the profile from the start, with a legend, follows the profile, and can be turned off', async () => {
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
      expect(ways.checked).toBe(true);
      await flush();
      view.fixture.detectChanges();
      expect(layerIds()).toContain('ways-good');
      expect(
        [
          ...view.root.querySelectorAll('.ways-legend:not(.surface-legend) li'),
        ].map((li) => li.textContent?.trim()),
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
      expect(
        view.root.querySelector('.ways-legend:not(.surface-legend)'),
      ).toBeNull();
    });

    it('offers the surface of the route, on at first, with a legend of the five categories, and lets it be turned off', async () => {
      const view = await renderWith(true);
      view.open();
      const box =
        view.root.querySelector<HTMLInputElement>('.surface-checkbox')!;
      expect(box.checked).toBe(true);
      expect(
        [...view.root.querySelectorAll('.surface-legend li')].map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['Paved', 'Cycleway', 'Unpaved or rough', 'Path', 'Unknown']);
      box.click();
      view.fixture.detectChanges();
      expect(view.root.querySelector('.surface-legend')).toBeNull();
      expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!).surface).toBe(
        false,
      );
    });

    it('says why the route has no colours, and asks for them', async () => {
      const view = await renderWith(true);
      view.open();
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

    it('offers no button when the route cannot be calculated again', async () => {
      const view = await renderWith(true);
      view.open();
      view.fixture.componentRef.setInput('surfaceMissing', true);
      view.fixture.componentRef.setInput('surfaceComputable', false);
      view.fixture.detectChanges();
      expect(view.root.querySelector('.layers-action')).toBeNull();
      expect(view.root.querySelector('.surface-note')?.textContent).toContain(
        'cannot be calculated again',
      );
    });

    it('offers the IGN photos, off at first, with a note about the server, and a credit once shown', async () => {
      const view = await renderWith(true);
      view.open();
      const box =
        view.root.querySelector<HTMLInputElement>('.imagery-checkbox')!;
      expect(box.checked).toBe(false);
      expect(box.disabled).toBe(false);
      expect(
        view.root.querySelector('#map-layers-imagery-note')?.textContent,
      ).toContain('Calls the IGN server');
      // Nothing external is asked for before the box is ticked.
      expect(
        JSON.stringify(maps[0].style ?? maps[0].options.style),
      ).not.toContain('geopf');
      expect(
        view.root.querySelector('.map-attribution')?.textContent,
      ).not.toContain('IGN');
      box.click();
      await flush();
      view.fixture.detectChanges();
      expect(JSON.stringify(maps[0].style)).toContain('data.geopf.fr');
      expect(
        view.root.querySelector('.map-attribution')?.textContent,
      ).toContain('Photos: IGN');
      expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!).imagery).toBe(
        true,
      );
    });

    it('goes back to the local map while the device is offline, and says so', async () => {
      localStorage.setItem(
        MAP_LAYERS_KEY,
        JSON.stringify({ relief: true, imagery: true }),
      );
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const view = await renderWith(true);
      view.open();
      const box =
        view.root.querySelector<HTMLInputElement>('.imagery-checkbox')!;
      expect(box.disabled).toBe(true);
      expect(
        view.root.querySelector('#map-layers-imagery-note')?.textContent,
      ).toContain('Not available offline');
      expect(
        JSON.stringify(maps[0].style ?? maps[0].options.style),
      ).not.toContain('geopf');
      expect(
        view.root.querySelector('.map-attribution')?.textContent,
      ).not.toContain('IGN');
    });

    it('says so when the map is centred where the basemap has no data', async () => {
      const view = await renderWith(false, [2.6, 45.3, 3.7, 46.1]);
      // The default view is on Clermont-Ferrand, inside the file.
      expect(view.root.querySelector('.map-note')).toBeNull();
      maps[0].center = { lng: 4.83, lat: 45.76 };
      maps[0].emit('moveend');
      view.fixture.detectChanges();
      expect(view.root.querySelector('.map-note')?.textContent).toContain(
        'No map data here',
      );
      maps[0].center = { lng: 3.1, lat: 45.7 };
      maps[0].emit('moveend');
      view.fixture.detectChanges();
      expect(view.root.querySelector('.map-note')).toBeNull();
    });

    it('says nothing when the extent of the file is not known', async () => {
      const view = await renderWith(false, null);
      maps[0].center = { lng: 40, lat: 10 };
      maps[0].emit('moveend');
      view.fixture.detectChanges();
      expect(view.root.querySelector('.map-note')).toBeNull();
    });

    describe('with the public terrain tiles', () => {
      it('shows the relief at once, with no probe of a file, a note about the server and a credit', async () => {
        const view = await renderWith(false, null, 'public');
        // The map was created without relief, then restyled with it at once.
        expect(view.sources()).toEqual(['protomaps', 'relief']);
        const style = maps[0].style as {
          sources: { relief: { tiles: string[]; tileSize: number } };
        };
        expect(style.sources.relief).toMatchObject({
          tiles: ['vlterrain://{z}/{x}/{y}'],
          tileSize: 256,
        });
        // No archive of ours to read: only the basemap is registered with the offline reader.
        expect(maps[0].options.offlineTiles?.map((t) => t.url)).toEqual([
          'http://tiles.test/basemap.pmtiles',
        ]);
        view.open();
        expect(view.checkbox()?.checked).toBe(true);
        expect(view.checkbox()?.disabled).toBe(false);
        expect(
          view.root.querySelector('#map-layers-relief-note')?.textContent,
        ).toContain('public Amazon server');
        const credit = view.root.querySelector<HTMLAnchorElement>(
          '.map-attribution a[href*="attribution.md"]',
        );
        expect(credit?.textContent).toContain('Terrain Tiles');
      });

      it('calls nothing and shows no credit once the user turns the relief off', async () => {
        const view = await renderWith(false, null, 'public');
        view.open();
        view.checkbox()!.click();
        await flush();
        view.fixture.detectChanges();
        expect(view.sources()).toEqual(['protomaps']);
        expect(
          view.root.querySelector('.map-attribution')?.textContent,
        ).not.toContain('Terrain Tiles');
      });
    });

    it('leaves the map as it is without the relief file, and says why', async () => {
      const view = await renderWith(false);
      expect(maps[0].calls).not.toContain('setStyle');
      view.open();
      expect(view.checkbox()?.disabled).toBe(true);
      expect(view.checkbox()?.checked).toBe(false);
      expect(
        view.root.querySelector('#map-layers-relief-note')?.textContent,
      ).toContain('Not available');
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
