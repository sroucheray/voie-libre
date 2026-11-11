import {
  BASEMAP_SOURCE,
  buildBasemapStyle,
  RELIEF_LAYER,
  RELIEF_SOURCE,
  reliefTilesUrl,
} from './basemap-style';

describe('with ways', () => {
  const base = 'http://tiles.test:8081/';
  const ids = (ways?: string | null) =>
    buildBasemapStyle(base, 'en', { ways }).layers.map((l) => l.id);

  it('draws no way layer unless asked, or for a profile without levels', () => {
    expect(ids().some((id) => id.startsWith('ways-'))).toBe(false);
    expect(ids(null).some((id) => id.startsWith('ways-'))).toBe(false);
    expect(ids('boat').some((id) => id.startsWith('ways-'))).toBe(false);
  });

  it('draws the three levels over every road and under the first label', () => {
    const style = buildBasemapStyle(base, 'en', { ways: 'road' });
    const all = style.layers.map((l) => l.id);
    expect(all.filter((id) => id.startsWith('ways-'))).toEqual([
      'ways-avoid',
      'ways-fair',
      'ways-good',
    ]);
    const first = all.indexOf('ways-avoid');
    const lastRoad = Math.max(
      ...style.layers.map((l, i) =>
        'source-layer' in l &&
        l['source-layer'] === 'roads' &&
        !l.id.startsWith('ways-') &&
        l.type === 'line'
          ? i
          : -1,
      ),
    );
    expect(first).toBeGreaterThan(lastRoad);
    expect(style.layers[first + 3].type).toBe('symbol');
  });

  it('keeps the relief under the water when both are asked', () => {
    const all = buildBasemapStyle(base, 'en', {
      ways: 'gravel',
      relief: true,
    }).layers.map((l) => l.id);
    expect(all.indexOf('relief')).toBe(all.indexOf('water') - 1);
    expect(all.indexOf('ways-good')).toBeGreaterThan(all.indexOf('water'));
  });
});

describe('buildBasemapStyle', () => {
  const style = buildBasemapStyle('http://tiles.test:8081/', 'en');

  it('reads tiles from the local PMTiles file, whatever trailing slash the base has', () => {
    expect(style.sources[BASEMAP_SOURCE]).toEqual({
      type: 'vector',
      url: 'pmtiles://http://tiles.test:8081/clermont.pmtiles',
    });
  });

  it('serves glyphs and sprites from the same base URL', () => {
    expect(style.glyphs).toBe(
      'http://tiles.test:8081/fonts/{fontstack}/{range}.pbf',
    );
    expect(style.sprite).toBe('http://tiles.test:8081/sprites/v4/light');
  });

  it('draws the Protomaps layers on that source', () => {
    expect(style.layers.length).toBeGreaterThan(50);
    const sources = new Set(
      style.layers.map((l) => ('source' in l ? l.source : undefined)),
    );
    expect(sources.has(BASEMAP_SOURCE)).toBe(true);
  });

  it('contains no URL outside the base URL', () => {
    const urls = JSON.stringify(style).match(/https?:\/\/[^"'\s]+/g) ?? [];
    expect(
      urls.filter((url) => !url.startsWith('http://tiles.test:8081')),
    ).toEqual([]);
  });

  it('has label layers, named in the requested language', () => {
    const symbols = style.layers.filter((l) => l.type === 'symbol');
    expect(symbols.length).toBeGreaterThan(5);
    expect(JSON.stringify(symbols)).toContain('name:en');
    expect(
      JSON.stringify(buildBasemapStyle('http://tiles.test', 'fr').layers),
    ).toContain('name:fr');
  });

  it('only asks for fonts that scripts/download-basemap.sh fetches', () => {
    const fonts = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key === 'text-font') collect(child);
          else walk(child);
        }
      }
    };
    const collect = (value: unknown) => {
      if (typeof value === 'string' && value.startsWith('Noto'))
        fonts.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    walk(style.layers);
    // Devanagari glyphs are only requested for Devanagari text, absent from the test region.
    const shipped = [
      'Noto Sans Italic',
      'Noto Sans Medium',
      'Noto Sans Regular',
    ];
    const missing = [...fonts].filter(
      (font) =>
        !shipped.includes(font) && !font.startsWith('Noto Sans Devanagari'),
    );
    expect(missing).toEqual([]);
    expect(fonts.has('Noto Sans Regular')).toBe(true);
  });

  describe('with relief', () => {
    const shaded = buildBasemapStyle('http://tiles.test:8081/', 'en', {
      relief: true,
    });

    it('has no relief unless asked', () => {
      expect(style.sources[RELIEF_SOURCE]).toBeUndefined();
      expect(style.layers.some((l) => l.id === RELIEF_LAYER)).toBe(false);
    });

    it('reads elevation tiles from the local archive, in the terrarium encoding', () => {
      expect(shaded.sources[RELIEF_SOURCE]).toEqual({
        type: 'raster-dem',
        url: 'pmtiles://http://tiles.test:8081/relief.pmtiles',
        encoding: 'terrarium',
        tileSize: 512,
        minzoom: 6,
        maxzoom: 11,
      });
      expect(reliefTilesUrl('http://tiles.test:8081/')).toBe(
        'http://tiles.test:8081/relief.pmtiles',
      );
    });

    it('draws the hillshade above the land and under water, roads and labels', () => {
      const ids = shaded.layers.map((l) => l.id);
      const at = ids.indexOf(RELIEF_LAYER);
      expect(shaded.layers[at].type).toBe('hillshade');
      expect(at).toBeGreaterThan(ids.indexOf('landcover'));
      expect(at).toBe(ids.indexOf('water') - 1);
      expect(at).toBeLessThan(ids.indexOf('roads_minor'));
      expect(shaded.layers).toHaveLength(style.layers.length + 1);
    });

    it('still contains no URL outside the base URL', () => {
      const urls = JSON.stringify(shaded).match(/https?:\/\/[^"'\s]+/g) ?? [];
      expect(
        urls.filter((url) => !url.startsWith('http://tiles.test:8081')),
      ).toEqual([]);
    });
  });
});
