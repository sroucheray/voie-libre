import { GeocodingError } from './geocoder';
import { PhotonProvider, photonLabel, photonShort } from './photon-provider';

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

describe('photonShort', () => {
  it('calls a searched place by its own name', () => {
    expect(photonShort({ type: 'city', name: 'Issoire' }, 'search')).toBe(
      'Issoire',
    );
    expect(
      photonShort(
        { type: 'other', name: 'Puy de Dôme', county: 'Puy-de-Dôme' },
        'search',
      ),
    ).toBe('Puy de Dôme');
    expect(
      photonShort(
        { type: 'district', name: 'Montferrand', city: 'Clermont-Ferrand' },
        'search',
      ),
    ).toBe('Montferrand');
  });

  it('calls an address, or a place with no name, by its locality', () => {
    expect(
      photonShort(
        {
          type: 'house',
          housenumber: '10',
          street: 'Rue Abbé Girard',
          city: 'Clermont-Ferrand',
        },
        'search',
      ),
    ).toBe('Clermont-Ferrand');
    expect(
      photonShort(
        { type: 'street', name: 'Rue de Bercy', city: 'Paris' },
        'search',
      ),
    ).toBe('Paris');
    expect(
      photonShort({ street: 'Rue de Bercy', district: 'Bercy' }, 'search'),
    ).toBe('Bercy');
  });

  it('calls the place found for a click by its locality, not by the shop or street there', () => {
    expect(
      photonShort(
        { type: 'other', name: 'Boulangerie Dupont', city: 'Issoire' },
        'reverse',
      ),
    ).toBe('Issoire');
    expect(
      photonShort(
        { type: 'house', street: 'Rue Abbé Girard', city: 'Clermont-Ferrand' },
        'reverse',
      ),
    ).toBe('Clermont-Ferrand');
  });

  it('falls back on the other name, and on nothing', () => {
    expect(photonShort({ type: 'city', name: 'Issoire' }, 'reverse')).toBe(
      'Issoire',
    );
    expect(photonShort({ type: 'house', name: 'Maison' }, 'search')).toBe(
      'Maison',
    );
    expect(photonShort({}, 'search')).toBeUndefined();
  });

  it('is on the places the provider returns', async () => {
    const provider = new PhotonProvider('https://photon.test', async () =>
      json({
        features: [
          feature([3.25, 45.54], {
            type: 'city',
            name: 'Issoire',
            country: 'France',
          }),
        ],
      }),
    );
    const [place] = await provider.search('Issoire', { lang: 'en', limit: 1 });
    expect(place).toEqual({
      label: 'Issoire, France',
      lon: 3.25,
      lat: 45.54,
      short: 'Issoire',
    });
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
      {
        label: 'Gare de Lyon, Paris',
        lon: 2.37,
        lat: 48.84,
        short: 'Gare de Lyon',
      },
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
      short: 'Paris',
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
