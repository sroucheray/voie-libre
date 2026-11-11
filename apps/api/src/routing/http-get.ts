import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * A GET that reads the whole answer with `node:http` and gives it back as a `Response`.
 *
 * Why not `fetch`: BRouter answers with `Connection: close` and no length, and a long route is a
 * few megabytes. Node's built-in `fetch` (undici) can then throw `assert(!this.paused)` when the
 * socket ends while the body is paused, and that assertion kills the whole process (seen in
 * production on Angers to Lyon). `node:http` has no such parser state to trip on.
 */
export function httpGet(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      { method: 'GET' },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('aborted', () =>
          reject(new Error('The connection closed before the answer ended')),
        );
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              headers.set(
                name,
                Array.isArray(value) ? value.join(', ') : value,
              );
            }
          }
          // A null-body status cannot carry a body in a Response.
          const status = response.statusCode ?? 502;
          const noBody = status === 204 || status === 205 || status === 304;
          resolve(
            new Response(noBody ? null : Buffer.concat(chunks), {
              status,
              statusText: response.statusMessage,
              headers,
            }),
          );
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}
