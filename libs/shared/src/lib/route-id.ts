/**
 * Alphabet of the short route ids: 32 lowercase letters and digits without the look-alikes
 * `0`, `1`, `l` and `o`. The device draws ids from it; the API accepts only ids made of it.
 */
export const ROUTE_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export const ROUTE_ID_MIN_LENGTH = 8;
export const ROUTE_ID_MAX_LENGTH = 10;

/** Matches a valid route id (8 to 10 characters of the alphabet). */
export const ROUTE_ID_PATTERN = `^[${ROUTE_ID_ALPHABET}]{${ROUTE_ID_MIN_LENGTH},${ROUTE_ID_MAX_LENGTH}}$`;
