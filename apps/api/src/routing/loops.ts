import {
  type AvoidZone,
  type Position,
  type RouteResult,
  RoutingError,
  type RoutingProfile,
  type RoutingProvider,
} from './routing-provider';

/** The first and last stretch of the way out stay open, or the way back could not start. */
const KEEP_OPEN_METERS = 400;
/** A simplified way out within this distance of the real one still follows its roads. */
const SIMPLIFY_METERS = 15;
/** Keeps the request short: longer routes are simplified more coarsely. */
const MAX_AVOID_POINTS = 350;

const EARTH_RADIUS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distance(a: readonly number[], b: readonly number[]): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[1])) *
      Math.cos(toRadians(b[1])) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

/** Douglas-Peucker on a local flat projection, tolerance in meters. */
export function simplify<T extends readonly number[]>(
  points: readonly T[],
  tolerance: number,
): T[] {
  if (points.length < 3) return [...points];
  const kx = 111_320 * Math.cos(toRadians(points[0][1]));
  const ky = 110_540;
  const xy = points.map((p) => [p[0] * kx, p[1] * ky]);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop() as [number, number];
    const [ax, ay] = xy[from];
    const dx = xy[to][0] - ax;
    const dy = xy[to][1] - ay;
    const length = Math.hypot(dx, dy) || 1e-9;
    let far = -1;
    let farDistance = -1;
    for (let i = from + 1; i < to; i++) {
      const d = Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / length;
      if (d > farDistance) {
        farDistance = d;
        far = i;
      }
    }
    if (farDistance > tolerance) {
      keep[far] = true;
      stack.push([from, far], [far, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * The way out as an area to avoid on the way back: a polyline over the route, without its first
 * and last {@link KEEP_OPEN_METERS}. `null` when the way out is too short to leave anything.
 */
export function outboundAvoidZone(
  geometry: readonly [number, number, number][],
): AvoidZone | null {
  const cumulative = [0];
  for (let i = 1; i < geometry.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(geometry[i - 1], geometry[i]));
  }
  const total = cumulative[cumulative.length - 1];
  const middle = geometry.filter(
    (_, i) =>
      cumulative[i] > KEEP_OPEN_METERS &&
      cumulative[i] < total - KEEP_OPEN_METERS,
  );
  if (middle.length < 2) return null;
  let line = simplify(middle, SIMPLIFY_METERS);
  for (let tolerance = SIMPLIFY_METERS; line.length > MAX_AVOID_POINTS;) {
    tolerance *= 1.5;
    line = simplify(line, tolerance);
  }
  return {
    kind: 'polyline',
    points: line.map(([lon, lat]) => ({
      lon: Math.round(lon * 1e5) / 1e5,
      lat: Math.round(lat * 1e5) / 1e5,
    })),
  };
}

const sameSpot = (a: Position, b: Position) =>
  a.lon === b.lon && a.lat === b.lat;

/** Joins the way out and the way back into one route (the way back starts where it ends). */
function join(out: RouteResult, back: RouteResult): RouteResult {
  return {
    geometry: [...out.geometry, ...back.geometry.slice(1)],
    distanceMeters: out.distanceMeters + back.distanceMeters,
    ascentMeters: out.ascentMeters + back.ascentMeters,
    durationSeconds: out.durationSeconds + back.durationSeconds,
  };
}

/**
 * Loops for the `loop` modes. `avoid_outbound`: the points go out and end on the start; the way
 * out (start, waypoints, turnaround) is routed as usual, then the way back from the turnaround
 * avoids it. If no way back exists around it, the plain way back is used: still a loop.
 */
export async function routeLoop(
  provider: RoutingProvider,
  points: Position[],
  profile: RoutingProfile,
  avoidZones: AvoidZone[],
  alternatives: number,
  loop:
    { mode: 'avoid_outbound' } | { mode: 'distance'; distanceMeters: number },
): Promise<RouteResult[]> {
  if (loop.mode === 'distance') {
    if (points.length !== 2 || !sameSpot(points[0], points[1])) {
      throw new RoutingError(
        'invalid_request',
        'A loop by distance needs the start twice and nothing else',
      );
    }
    if (!provider.roundTrip) {
      throw new RoutingError(
        'invalid_request',
        `${provider.name} cannot draw loops by distance`,
      );
    }
    return provider.roundTrip(
      points[0],
      profile,
      avoidZones,
      alternatives,
      loop.distanceMeters,
    );
  }

  if (points.length < 3 || !sameSpot(points[0], points[points.length - 1])) {
    throw new RoutingError(
      'invalid_request',
      'A loop avoiding the way out needs a turnaround and a last point on the start',
    );
  }
  const turnaround = points[points.length - 2];
  const start = points[0];
  const outs = await provider.route(
    points.slice(0, -1),
    profile,
    avoidZones,
    alternatives,
  );
  return Promise.all(
    outs.map(async (out) => {
      const zone = outboundAvoidZone(out.geometry);
      const back = async (zones: AvoidZone[]) =>
        (await provider.route([turnaround, start], profile, zones, 1))[0];
      if (!zone) return join(out, await back(avoidZones));
      try {
        return join(out, await back([...avoidZones, zone]));
      } catch (error) {
        if (error instanceof RoutingError && error.code === 'no_route') {
          return join(out, await back(avoidZones));
        }
        throw error;
      }
    }),
  );
}
