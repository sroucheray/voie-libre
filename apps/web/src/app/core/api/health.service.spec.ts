import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import { API_CLIENT } from './api-client';
import { HealthService } from './health.service';

function serviceWith(respond: () => Promise<Response>): HealthService {
  const client = createApiClient({
    baseUrl: 'http://api.test',
    fetch: respond,
  });
  TestBed.configureTestingModule({
    providers: [{ provide: API_CLIENT, useValue: client }],
  });
  return TestBed.inject(HealthService);
}

const json = (body: unknown, status: number) => async () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('HealthService', () => {
  it('starts as checking', () => {
    expect(serviceWith(json({}, 200)).status()).toBe('checking');
  });

  it('reports ok when the API and the database are up', async () => {
    const service = serviceWith(
      json({ status: 'ok', api: 'up', database: 'up' }, 200),
    );
    await service.check();
    expect(service.status()).toBe('ok');
  });

  it('reports degraded when the API answers 503', async () => {
    const service = serviceWith(
      json({ status: 'degraded', api: 'up', database: 'down' }, 503),
    );
    await service.check();
    expect(service.status()).toBe('degraded');
  });

  it('reports unreachable when the request fails', async () => {
    const service = serviceWith(async () => {
      throw new TypeError('Failed to fetch');
    });
    await service.check();
    expect(service.status()).toBe('unreachable');
  });
});
