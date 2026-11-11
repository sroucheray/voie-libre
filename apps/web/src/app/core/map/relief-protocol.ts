import { publicReliefTileUrl } from './relief-source';

/**
 * The `vlterrain://{z}/{x}/{y}` protocol of the hillshade: a tile kept in an offline area comes
 * first (any cache holds it under the public URL), the public server otherwise. A tile that cannot
 * be had is an error, which MapLibre reports and `retryFailedTiles` asks for again.
 */
export async function reliefTileProtocol(
  params: { url: string },
  abort: { signal: AbortSignal },
): Promise<{ data: ArrayBuffer }> {
  const match = /^[a-z]+:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
  if (!match) throw new Error(`Not a relief tile: ${params.url}`);
  const url = publicReliefTileUrl(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
  const kept = await globalThis.caches?.match(url).catch(() => undefined);
  if (kept) return { data: await kept.arrayBuffer() };
  const response = await fetch(url, { signal: abort.signal });
  if (!response.ok) {
    throw new Error(`Relief tile ${url}: HTTP ${response.status}`);
  }
  return { data: await response.arrayBuffer() };
}
