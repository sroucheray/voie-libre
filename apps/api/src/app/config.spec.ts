import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses local development defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.corsOrigins).toEqual(['http://localhost:4200']);
    expect(config.brouterUrl).toBe('http://localhost:17777');
    expect(config.brouterMaxConcurrent).toBe(2);
    expect(config.geocoderUrl).toBe('https://photon.komoot.io');
  });

  it('reads values and splits the CORS origins', () => {
    const config = loadConfig({
      PORT: '8080',
      CORS_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow('PORT');
  });
});
