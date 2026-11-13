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

/** Elevation changes smaller than this are noise, not climbing (same rule as the GPX import). */
const CLIMB_THRESHOLD_METERS = 3;
/**
 * Lower bounds, in percent, of the grade bands the chart is coloured with. A band is the index of
 * the last bound the steepness (up or down) reaches.
 */
export const GRADE_BANDS = [0, 3, 6, 10, 15] as const;

/** The band of a grade in percent: 0 for nearly flat, `GRADE_BANDS.length - 1` for the steepest. */
export function gradeBand(grade: number): number {
  const steepness = Math.abs(grade);
  let band = 0;
  for (let i = 1; i < GRADE_BANDS.length; i++) {
    if (steepness >= GRADE_BANDS[i]) band = i;
  }
  return band;
}

/** Consecutive samples (`from` to `to`, both included) drawn in the colour of one band. */
export interface GradeRun {
  band: number;
  from: number;
  to: number;
}

/** The profile cut into runs of one grade band; a run ends on the sample the next one starts at. */
export function gradeRuns(profile: ElevationProfile): GradeRun[] {
  const { samples } = profile;
  const runs: GradeRun[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const band = gradeBand((samples[i].grade + samples[i + 1].grade) / 2);
    const last = runs[runs.length - 1];
    if (last && last.band === band) last.to = i + 1;
    else runs.push({ band, from: i, to: i + 1 });
  }
  return runs;
}

/** What a stretch of the route adds up to. */
export interface StretchStats {
  distance: number;
  ascent: number;
  descent: number;
  /** Average slope in percent, from the first point to the last. */
  grade: number;
}

/** Totals between two samples, in either order. Wobbles under 3 m count as neither up nor down. */
export function stretchStats(
  profile: ElevationProfile,
  a: number,
  b: number,
): StretchStats {
  const last = profile.samples.length - 1;
  const from = Math.max(0, Math.min(a, b, last));
  const to = Math.min(last, Math.max(a, b, 0));
  const start = profile.samples[from];
  const end = profile.samples[to];
  let reference = start.elevation;
  let ascent = 0;
  let descent = 0;
  for (let i = from + 1; i <= to; i++) {
    const delta = profile.samples[i].elevation - reference;
    if (delta >= CLIMB_THRESHOLD_METERS) ascent += delta;
    else if (-delta >= CLIMB_THRESHOLD_METERS) descent -= delta;
    else continue;
    reference = profile.samples[i].elevation;
  }
  const distance = end.distance - start.distance;
  return {
    distance,
    ascent,
    descent,
    grade:
      distance > 0 ? ((end.elevation - start.elevation) / distance) * 100 : 0,
  };
}

/** The box the chart paths are drawn in; the SVG stretches it to its element. */
export const PROFILE_WIDTH = 1000;
export const PROFILE_HEIGHT = 100;

export interface ProfilePaths {
  /** The line along the elevations. */
  line: string;
  /** One filled shape per run of the same grade band, down to the bottom of the chart. */
  areas: { band: number; d: string }[];
}

/** The line and the coloured areas of a profile, in a `PROFILE_WIDTH` by `PROFILE_HEIGHT` box. */
export function profilePaths(profile: ElevationProfile): ProfilePaths {
  const span = Math.max(profile.maxElevation - profile.minElevation, 1);
  const points = profile.samples.map((sample) => {
    const x = (sample.distance / profile.totalDistance) * PROFILE_WIDTH;
    const y =
      PROFILE_HEIGHT -
      ((sample.elevation - profile.minElevation) / span) * PROFILE_HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areas = gradeRuns(profile).map((run) => {
    const first = points[run.from].split(',')[0];
    const last = points[run.to].split(',')[0];
    const top = points.slice(run.from, run.to + 1).join('L');
    return {
      band: run.band,
      d: `M${first},${PROFILE_HEIGHT}L${top}L${last},${PROFILE_HEIGHT}Z`,
    };
  });
  return { line: `M${points.join('L')}`, areas };
}
