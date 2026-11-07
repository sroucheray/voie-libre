import type { LngLat3 } from './planner-map-driver';

const EARTH_RADIUS_METERS = 6_371_000;
/** Distance either side of a sample used to measure its grade: single points are too noisy. */
const GRADE_WINDOW_METERS = 50;

/** One point of the profile. `index` is the position in the route geometry. */
export interface ProfileSample {
  index: number;
  /** Distance from the start, in meters. */
  distance: number;
  elevation: number;
  /** Slope in percent, measured over a short window around the point. */
  grade: number;
  lngLat: [number, number];
}

export interface ElevationProfile {
  samples: ProfileSample[];
  totalDistance: number;
  minElevation: number;
  maxElevation: number;
}

/** Distance in meters between two `[lon, lat, …]` positions. */
export function haversine(a: LngLat3, b: LngLat3): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance against elevation along a route, or `null` when there is nothing to draw (fewer than
 * two points, or a route of zero length).
 */
export function buildProfile(geometry: LngLat3[]): ElevationProfile | null {
  if (geometry.length < 2) return null;

  const distances = [0];
  for (let i = 1; i < geometry.length; i++) {
    distances.push(distances[i - 1] + haversine(geometry[i - 1], geometry[i]));
  }
  const totalDistance = distances[distances.length - 1];
  if (totalDistance <= 0) return null;

  let minElevation = Infinity;
  let maxElevation = -Infinity;
  const samples: ProfileSample[] = geometry.map((point, index) => {
    minElevation = Math.min(minElevation, point[2]);
    maxElevation = Math.max(maxElevation, point[2]);
    return {
      index,
      distance: distances[index],
      elevation: point[2],
      grade: 0,
      lngLat: [point[0], point[1]],
    };
  });

  // Grade over the window: the first and last samples whose distance is within it.
  let from = 0;
  let to = 0;
  for (const sample of samples) {
    while (sample.distance - samples[from].distance > GRADE_WINDOW_METERS) {
      from++;
    }
    while (
      to < samples.length - 1 &&
      samples[to].distance - sample.distance < GRADE_WINDOW_METERS
    ) {
      to++;
    }
    // Samples farther apart than the window still use their direct neighbours.
    const start = samples[Math.min(from, Math.max(0, sample.index - 1))];
    const end =
      samples[Math.max(to, Math.min(samples.length - 1, sample.index + 1))];
    const run = end.distance - start.distance;
    sample.grade =
      run > 0 ? ((end.elevation - start.elevation) / run) * 100 : 0;
  }

  return { samples, totalDistance, minElevation, maxElevation };
}

/** The sample closest to `distance` meters from the start. */
export function sampleAtDistance(
  profile: ElevationProfile,
  distance: number,
): ProfileSample {
  const { samples } = profile;
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle].distance <= distance) low = middle;
    else high = middle;
  }
  return Math.abs(samples[low].distance - distance) <=
    Math.abs(samples[high].distance - distance)
    ? samples[low]
    : samples[high];
}

/** The sample closest to a position on the map (flat approximation, fine at route scale). */
export function sampleNearest(
  profile: ElevationProfile,
  lngLat: [number, number],
): ProfileSample {
  const cos = Math.cos((lngLat[1] * Math.PI) / 180);
  let best = profile.samples[0];
  let bestDistance = Infinity;
  for (const sample of profile.samples) {
    const dx = (sample.lngLat[0] - lngLat[0]) * cos;
    const dy = sample.lngLat[1] - lngLat[1];
    const d = dx * dx + dy * dy;
    if (d < bestDistance) {
      bestDistance = d;
      best = sample;
    }
  }
  return best;
}
