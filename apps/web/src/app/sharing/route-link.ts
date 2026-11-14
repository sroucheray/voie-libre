import type { LngLat } from '../core/map/map-factory';
import {
  LOOP_ASCENT_MAX_METERS,
  LOOP_DIRECTIONS,
  LOOP_DISTANCE_MAX_METERS,
  LOOP_DISTANCE_MIN_METERS,
  MAX_POINTS,
  PROFILES,
  type LoopDirection,
  type LoopMode,
  type Profile,
} from '../planner/planner-store';

/**
 * A route as a link carries it: the points, the profile, the loop mode and a name. No track, no
 * elevation: the device that opens the link computes the route again.
 */
export interface RouteLink {
  points: LngLat[];
  profile: Profile;
  loop: LoopMode | null;
  name?: string;
}

/** Why a link could not be read; the UI translates these under `sharing.link.errors.*`. */
export type RouteLinkErrorCode =
  'unreadable' | 'unsupported_version' | 'invalid';

export type RouteLinkResult =
  { ok: true; link: RouteLink } | { ok: false; code: RouteLinkErrorCode };

/** The format version written first in the fragment, so that the format can change. */
export const ROUTE_LINK_VERSION = '1';
/** A name longer than this is cut: a link has to stay short for messengers. */
export const ROUTE_LINK_NAME_MAX = 80;
/** Where the web app opens a link. */
export const ROUTE_LINK_PATH = '/r';

const SCALE = 1e5;
/** 6 bits per character: bit 5 says "more follows", the other five carry the value. */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function writeNumber(value: number): string {
  // Zigzag, so that a small negative number stays small.
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (rest >= 0x20) {
    out += ALPHABET[(rest & 0x1f) | 0x20];
    rest >>>= 5;
  }
  return out + ALPHABET[rest];
}

/** Coordinates to text: each one as the step from the previous one, 5 decimals (about 1 m). */
function encodePoints(points: readonly LngLat[]): string {
  let lng = 0;
  let lat = 0;
  let out = '';
  for (const point of points) {
    const nextLng = Math.round(point[0] * SCALE);
    const nextLat = Math.round(point[1] * SCALE);
    out += writeNumber(nextLat - lat) + writeNumber(nextLng - lng);
    lng = nextLng;
    lat = nextLat;
  }
  return out;
}

function decodePoints(text: string): LngLat[] | null {
  const numbers: number[] = [];
  let shift = 0;
  let acc = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return null;
    acc += (digit & 0x1f) * 2 ** shift;
    if (digit & 0x20) {
      shift += 5;
      // Far more than any coordinate step: a damaged link, not a route.
      if (shift > 30) return null;
    } else {
      numbers.push(acc % 2 === 1 ? -(acc + 1) / 2 : acc / 2);
      acc = 0;
      shift = 0;
    }
  }
  if (shift !== 0 || numbers.length === 0 || numbers.length % 2 !== 0) {
    return null;
  }
  const points: LngLat[] = [];
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < numbers.length; i += 2) {
    lat += numbers[i];
    lng += numbers[i + 1];
    points.push([lng / SCALE, lat / SCALE]);
  }
  return points;
}

function encodeLoop(loop: LoopMode): string {
  if (loop.mode === 'avoid_outbound') return 'a';
  const parts = [
    `d${Math.round(loop.distanceMeters)}`,
    loop.ascentMeters === undefined ? '' : `${Math.round(loop.ascentMeters)}`,
    loop.direction ?? '',
  ];
  // Trailing empty parts are dropped: `d30000`, `d30000,500`, `d30000,,ne`.
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.join(',');
}

function decodeLoop(text: string): LoopMode | null | undefined {
  if (text === 'a') return { mode: 'avoid_outbound' };
  const match = /^d(\d+)(?:,(\d*))?(?:,([a-z]*))?$/.exec(text);
  if (!match) return undefined;
  const distanceMeters = Number(match[1]);
  if (
    distanceMeters < LOOP_DISTANCE_MIN_METERS ||
    distanceMeters > LOOP_DISTANCE_MAX_METERS
  ) {
    return undefined;
  }
  const loop: LoopMode = { mode: 'distance', distanceMeters };
  if (match[2]) {
    const ascentMeters = Number(match[2]);
    if (ascentMeters > LOOP_ASCENT_MAX_METERS) return undefined;
    loop.ascentMeters = ascentMeters;
  }
  if (match[3]) {
    if (!(LOOP_DIRECTIONS as readonly string[]).includes(match[3])) {
      return undefined;
    }
    loop.direction = match[3] as LoopDirection;
  }
  return loop;
}

/**
 * The fragment (without the `#`) of a link to this route, for example
 * `v=1&p=road&c=…&l=a&n=Morning%20ride`. Coordinates are rounded to 5 decimals.
 */
export function encodeRouteLink(link: RouteLink): string {
  const parts = [
    `v=${ROUTE_LINK_VERSION}`,
    `p=${link.profile}`,
    `c=${encodePoints(link.points)}`,
  ];
  if (link.loop) parts.push(`l=${encodeLoop(link.loop)}`);
  const name = link.name?.trim().slice(0, ROUTE_LINK_NAME_MAX);
  if (name) parts.push(`n=${encodeURIComponent(name)}`);
  return parts.join('&');
}

/** The full address of the link, to copy or to share. */
export function routeLinkUrl(origin: string, link: RouteLink): string {
  return `${origin}${ROUTE_LINK_PATH}#${encodeRouteLink(link)}`;
}

/** Reads a fragment (with or without the leading `#`); never throws. */
export function decodeRouteLink(fragment: string): RouteLinkResult {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const version = params.get('v');
  if (version === null) return { ok: false, code: 'unreadable' };
  if (version !== ROUTE_LINK_VERSION) {
    return { ok: false, code: 'unsupported_version' };
  }
  const profile = params.get('p');
  const encoded = params.get('c');
  if (!(PROFILES as readonly string[]).includes(profile ?? '') || !encoded) {
    return { ok: false, code: 'invalid' };
  }
  const points = decodePoints(encoded);
  if (
    !points ||
    points.length < 2 ||
    points.length > MAX_POINTS ||
    points.some(([lng, lat]) => Math.abs(lng) > 180 || Math.abs(lat) > 90)
  ) {
    return { ok: false, code: 'invalid' };
  }
  const link: RouteLink = { points, profile: profile as Profile, loop: null };
  const loopText = params.get('l');
  if (loopText !== null) {
    const loop = decodeLoop(loopText);
    if (loop === undefined) return { ok: false, code: 'invalid' };
    link.loop = loop;
  }
  const name = params.get('n')?.trim().slice(0, ROUTE_LINK_NAME_MAX);
  if (name) link.name = name;
  return { ok: true, link };
}
