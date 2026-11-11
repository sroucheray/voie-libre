import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import { GeocodingService } from './geocoding.service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('GeocodingService', () => {
  const urls: string[] = [];
  let respond: (request: Request) => Response | Promise<Response>;

  const service = () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              urls.push(request.url);
              return respond(request);
            },
          }),
        },
        { provide: LanguageService, useValue: { current: () => 'fr' } },
      ],
    });
    return TestBed.inject(GeocodingService);
  };

  beforeEach(() => {
    urls.length = 0;
  });

  it('searches in the UI language, biased by a position, and maps places to points', async () => {
    respond = () =>
      json({
        places: [{ label: 'Gare de Lyon, Paris', lon: 2.37, lat: 48.84 }],
      });
    const result = await service().search(
      'gare',
      new AbortController().signal,
      [2.3, 48.8],
    );
    expect(result).toEqual({
      places: [{ label: 'Gare de Lyon, Paris', point: [2.37, 48.84] }],
    });
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/geocode');
    expect(url.searchParams.get('q')).toBe('gare');
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.get('lon')).toBe('2.3');
    expect(url.searchParams.get('lat')).toBe('48.8');
  });

  it.each([
    [429, { message: 'Rate limit exceeded' }, 'rate_limited'],
    [503, { code: 'unavailable', message: 'down' }, 'unavailable'],
    [504, undefined, 'unavailable'],
    [400, { code: 'invalid_request', message: 'bad' }, 'invalid_request'],
    [500, { message: 'boom' }, 'unknown'],
  ] as const)(
    'turns a %i answer into the %s code',
    async (status, body, code) => {
      respond = () => json(body ?? {}, status);
      expect(
        await service().search('gare', new AbortController().signal),
      ).toEqual({ error: code });
    },
  );

  it('reports a network failure as unavailable, and an abort as null', async () => {
    respond = () => {
      throw new TypeError('network');
    };
    const s = service();
    expect(await s.search('gare', new AbortController().signal)).toEqual({
      error: 'unavailable',
    });
    const controller = new AbortController();
    controller.abort();
    expect(await s.search('gare', controller.signal)).toBeNull();
  });

  it('reverses a position to a label, or null when there is none or it fails', async () => {
    respond = () =>
      json({
        place: {
          label: 'Rue de Bercy, Paris',
          short: 'Paris',
          lon: 2.37,
          lat: 48.84,
        },
      });
    const s = service();
    expect(await s.reverse([2.37, 48.84])).toEqual({
      label: 'Rue de Bercy, Paris',
      short: 'Paris',
    });
    expect(new URL(urls[0]).pathname).toBe('/geocode/reverse');
    respond = () => json({ place: null });
    expect(await s.reverse([0, 0])).toBeNull();
    respond = () => json({}, 503);
    expect(await s.reverse([0, 0])).toBeNull();
  });
});
