import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { FakeMap, provideFakeMap } from '../../../testing/fake-map';
import { LanguageService } from '../i18n/language.service';
import { BASEMAP_URL, LngLat, MAP_FACTORY } from './map-factory';
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
    expect(buttons(fixture)).toHaveLength(2);
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
