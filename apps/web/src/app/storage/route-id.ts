import { ROUTE_ID_ALPHABET } from '@voie-libre/shared';

// 32 divides 256, so masking a random byte introduces no modulo bias.
export { ROUTE_ID_ALPHABET };

/** 10 characters, 50 bits: enough to stay unique without a server, short enough for `/p/{id}`. */
export const ROUTE_ID_LENGTH = 10;

/** A short random id for a saved route, from `crypto.getRandomValues`. */
export function createRouteId(length = ROUTE_ID_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const byte of bytes) {
    id += ROUTE_ID_ALPHABET[byte & (ROUTE_ID_ALPHABET.length - 1)];
  }
  return id;
}
