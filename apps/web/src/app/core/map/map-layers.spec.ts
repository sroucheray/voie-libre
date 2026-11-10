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
