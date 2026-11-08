import { GeocodingError } from './geocoder';
import { PhotonProvider, photonLabel } from './photon-provider';

const feature = (
  coordinates: [number, number],
  properties: Record<string, string>,
) => ({ geometry: { type: 'Point', coordinates }, properties });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('photonLabel', () => {
  it('joins name, street, city and country, skipping gaps and repeats', () => {
    expect(
      photonLabel({
        name: 'Gare de Lyon',
        housenumber: '1',
        street: 'Place Louis-Armand',
        city: 'Paris',
        country: 'France',
      }),
    ).toBe('Gare de Lyon, 1 Place Louis-Armand, Paris, France');
    expect(
      photonLabel({ name: 'Paris', city: 'Paris', country: 'France' }),
    ).toBe('Paris, France');
    expect(photonLabel({})).toBe('');
  });
});

describe('PhotonProvider', () => {
  it('searches with language, limit and a bias position', async () => {
    const urls: string[] = [];
    const provider = new PhotonProvider('https://photon.test/', async (url) => {
      urls.push(url);
      return json({
        features: [
          feature([2.37, 48.84], { name: 'Gare de Lyon', city: 'Paris' }),
          { geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
        ],
      });
    });
    const places = await provider.search('gare de lyon', {
      lang: 'fr',
      limit: 5,
      near: { lon: 2.3, lat: 48.8 },
    });
    expect(places).toEqual([
      { label: 'Gare de Lyon, Paris', lon: 2.37, lat: 48.84 },
    ]);
    const url = new URL(urls[0]);
    expect(url.origin + url.pathname).toBe('https://photon.test/api');
    expect(url.searchParams.get('q')).toBe('gare de lyon');
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('lat')).toBe('48.8');
    expect(url.searchParams.get('lon')).toBe('2.3');
  });

  it('reverses a position to the nearest place, or null', async () => {
    const urls: string[] = [];
    let features: unknown[] = [
      feature([2.37, 48.84], { street: 'Rue de Bercy', city: 'Paris' }),
    ];
    const provider = new PhotonProvider('https://photon.test', async (url) => {
      urls.push(url);
      return json({ features });
    });
    expect(
      await provider.reverse({ lon: 2.37, lat: 48.84 }, { lang: 'en' }),
    ).toEqual({
      label: 'Rue de Bercy, Paris',
      lon: 2.37,
      lat: 48.84,
    });
    expect(new URL(urls[0]).pathname).toBe('/reverse');
    features = [];
    expect(
      await provider.reverse({ lon: 0, lat: 0 }, { lang: 'en' }),
    ).toBeNull();
  });

  it('reports an unreachable or overloaded server as unavailable', async () => {
    const down = new PhotonProvider('https://photon.test', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      down.search('x', { lang: 'en', limit: 5 }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const busy = new PhotonProvider('https://photon.test', async () =>
      json({}, 429),
    );
    await expect(
      busy.search('x', { lang: 'en', limit: 5 }),
    ).rejects.toBeInstanceOf(GeocodingError);
    await expect(
      busy.search('x', { lang: 'en', limit: 5 }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports other failures as provider errors', async () => {
    const provider = new PhotonProvider(
      'https://photon.test',
      async () => new Response('not json', { status: 200 }),
    );
    await expect(
      provider.search('x', { lang: 'en', limit: 5 }),
    ).rejects.toMatchObject({ code: 'provider_error' });
  });
});
