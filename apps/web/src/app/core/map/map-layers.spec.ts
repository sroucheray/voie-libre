import { TestBed } from '@angular/core/testing';
import { MAP_LAYERS_KEY, MapLayers, probeWithHead } from './map-layers';

describe('MapLayers', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows the relief until the user turns it off, and remembers', () => {
    const layers = TestBed.inject(MapLayers);
    expect(layers.relief()).toBe(true);
    layers.setRelief(false);
    expect(layers.relief()).toBe(false);
    TestBed.resetTestingModule();
    expect(TestBed.inject(MapLayers).relief()).toBe(false);
  });

  it('shows the ways until the user turns them off, and remembers', () => {
    const layers = TestBed.inject(MapLayers);
    expect(layers.ways()).toBe(true);
    layers.setWays(false);
    expect(layers.ways()).toBe(false);
    expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!)).toEqual({
      relief: true,
      ways: false,
      surface: true,
      imagery: false,
    });
    TestBed.resetTestingModule();
    expect(TestBed.inject(MapLayers).ways()).toBe(false);
  });

  it('shows the surface of the route until the user turns it off, and remembers', () => {
    const layers = TestBed.inject(MapLayers);
    expect(layers.surface()).toBe(true);
    layers.setSurface(false);
    expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!)).toEqual({
      relief: true,
      ways: true,
      surface: false,
      imagery: false,
    });
    TestBed.resetTestingModule();
    expect(TestBed.inject(MapLayers).surface()).toBe(false);
  });

  it('leaves the aerial photos off until the user turns them on, and remembers', () => {
    const layers = TestBed.inject(MapLayers);
    expect(layers.imagery()).toBe(false);
    layers.setImagery(true);
    expect(JSON.parse(localStorage.getItem(MAP_LAYERS_KEY)!).imagery).toBe(
      true,
    );
    TestBed.resetTestingModule();
    expect(TestBed.inject(MapLayers).imagery()).toBe(true);
  });

  it('ignores a stored value it does not understand', () => {
    localStorage.setItem(MAP_LAYERS_KEY, '{"relief":"yes"');
    expect(TestBed.inject(MapLayers).relief()).toBe(true);
  });

  it('keeps the choice for the session when the storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const layers = TestBed.inject(MapLayers);
    layers.setRelief(false);
    expect(layers.relief()).toBe(false);
  });
});

describe('probeWithHead', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for the headers only, and is false for a missing file or no network', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await probeWithHead('http://tiles.test/relief.pmtiles')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('http://tiles.test/relief.pmtiles', {
      method: 'HEAD',
    });
    expect(await probeWithHead('http://tiles.test/relief.pmtiles')).toBe(false);
    expect(await probeWithHead('http://tiles.test/relief.pmtiles')).toBe(false);
  });
});
