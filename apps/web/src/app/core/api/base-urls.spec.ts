import { baseUrlsFor, currentBaseUrls } from './base-urls';

describe('baseUrlsFor', () => {
  it('uses the local ports on the developer machine', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      expect(
        baseUrlsFor({ hostname, origin: `http://${hostname}:4200` }),
      ).toEqual({
        api: 'http://localhost:3000',
        tiles: 'http://localhost:8081',
      });
    }
  });

  it('uses the page origin behind the reverse proxy', () => {
    expect(
      baseUrlsFor({
        hostname: 'voielibre.app',
        origin: 'https://voielibre.app',
      }),
    ).toEqual({
      api: 'https://voielibre.app/api',
      tiles: 'https://voielibre.app/tiles',
    });
  });

  it('gives the local addresses in the test page', () => {
    expect(currentBaseUrls()).toEqual({
      api: 'http://localhost:3000',
      tiles: 'http://localhost:8081',
    });
  });
});
