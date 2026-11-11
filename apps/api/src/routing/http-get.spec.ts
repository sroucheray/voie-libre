import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpGet } from './http-get';

describe('httpGet', () => {
  let server: Server;
  let base: string;

  const listen = async (handler: Parameters<typeof createServer>[1]) => {
    server = createServer(handler);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('reads a large body sent with Connection: close and no length', async () => {
    const big = 'x'.repeat(5_000_000);
    await listen((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        Connection: 'close',
      });
      response.end(big);
    });
    const response = await httpGet(`${base}/brouter?lonlats=1,2|3,4`);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect((await response.text()).length).toBe(big.length);
  });

  it('gives the status and the text of an error answer', async () => {
    await listen((_request, response) => {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('no track found');
    });
    const response = await httpGet(`${base}/`);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('no track found');
  });

  it('rejects when the server is not there', async () => {
    await listen((_request, response) => response.end());
    const closed = base;
    await new Promise((resolve) => server.close(resolve));
    await expect(httpGet(`${closed}/`)).rejects.toThrow();
    // afterEach closes the (already closed) server again: give it a fresh one.
    await listen((_request, response) => response.end());
  });

  it('rejects when the connection drops before the answer ends', async () => {
    await listen((request, response) => {
      response.writeHead(200, { 'Content-Length': '1000' });
      response.write('partial');
      setTimeout(() => request.socket.destroy(), 20);
    });
    await expect(httpGet(`${base}/`)).rejects.toThrow();
  });
});
