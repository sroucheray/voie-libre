import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LngLat3 } from './planner-map-driver';

/** How far apart (m) the two ways of a stretch ridden both ways may lie and still be one stretch. */
const SAME_WAY_METERS = 12;
/** Samples are taken every so many meters along a segment. */
const SAMPLE_METERS = 8;
/** Opposite directions: the cosine of the angle between two segments is below this. */
const OPPOSITE_COSINE = -0.5;
/** A stretch shorter than this between two of the other kind is not a stretch of its own. */
const SHORT_STRETCH_METERS = 30;

export type DirectionKind = 'single' | 'double';

/** A stretch of the route, ridden one way only (`single`) or both ways (`double`). */
export interface DirectionRun {
  kind: DirectionKind;
  /** Vertices `from` to `to`, both included. */
  from: number;
  to: number;
}

interface Sample {
  x: number;
  y: number;
  /** Unit direction of the segment it comes from. */
  dx: number;
  dy: number;
  segment: number;
}

/**
 * Cuts a route into runs ridden one way and runs ridden both ways (an out-and-back: the way out and
 * the way back lie on the same ways, in opposite directions). A segment is `double` when most of
 * it lies within a few meters of another part of the route that goes the other way. The ways of an
 * out-and-back need not be the same vertices, only the same place.
 */
export function directionRuns(geometry: LngLat3[]): DirectionRun[] {
  const count = geometry.length - 1;
  if (count < 1) return [];
  const lat0 = (geometry[0][1] * Math.PI) / 180;
  const metersPerLon = 111_320 * Math.cos(lat0);
  const metersPerLat = 110_540;
  const points = geometry.map(([lon, lat]) => ({
    x: lon * metersPerLon,
    y: lat * metersPerLat,
  }));

  const samples: Sample[] = [];
  const bySegment: Sample[][] = [];
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const own: Sample[] = [];
    bySegment.push(own);
    if (length < 0.5) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const steps = Math.max(1, Math.round(length / SAMPLE_METERS));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const sample = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        dx,
        dy,
        segment: i,
      };
      own.push(sample);
      samples.push(sample);
    }
  }

  // A grid of the cell size of the tolerance: a sample only meets the ones in the nine cells around.
  const cell = SAME_WAY_METERS;
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const grid = new Map<string, Sample[]>();
  for (const sample of samples) {
    const k = key(Math.floor(sample.x / cell), Math.floor(sample.y / cell));
    const list = grid.get(k);
    if (list) list.push(sample);
    else grid.set(k, [sample]);
  }
  const hasOpposite = (sample: Sample): boolean => {
    const cx = Math.floor(sample.x / cell);
    const cy = Math.floor(sample.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const other of grid.get(key(gx, gy)) ?? []) {
          if (other.segment === sample.segment) continue;
          if (Math.hypot(other.x - sample.x, other.y - sample.y) > cell)
            continue;
          if (other.dx * sample.dx + other.dy * sample.dy < OPPOSITE_COSINE) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const kinds: DirectionKind[] = bySegment.map((own) => {
    if (own.length === 0) return 'single';
    const matched = own.filter(hasOpposite).length;
    return matched * 2 >= own.length ? 'double' : 'single';
  });
  // A segment too short to have samples takes the kind of the one before it (a vertex, not a stretch).
  for (let i = 1; i < count; i++) {
    if (bySegment[i].length === 0) kinds[i] = kinds[i - 1];
  }

  // A short stretch between two of the other kind is a turn at the tip of an out-and-back, or a
  // vertex of the way back: it takes the kind of its neighbours.
  const lengths = points
    .slice(1)
    .map((b, i) => Math.hypot(b.x - points[i].x, b.y - points[i].y));
  const cut = (): DirectionRun[] => {
    const cuts: DirectionRun[] = [];
    for (let i = 0; i < count; i++) {
      const last = cuts[cuts.length - 1];
      if (last && last.kind === kinds[i]) last.to = i + 1;
      else cuts.push({ kind: kinds[i], from: i, to: i + 1 });
    }
    return cuts;
  };
  let runs = cut();
  for (let i = 1; i < runs.length - 1; i++) {
    if (runs[i - 1].kind !== runs[i + 1].kind) continue;
    const meters = lengths
      .slice(runs[i].from, runs[i].to)
      .reduce((sum, length) => sum + length, 0);
    if (meters >= SHORT_STRETCH_METERS) continue;
    for (let k = runs[i].from; k < runs[i].to; k++) kinds[k] = runs[i - 1].kind;
    runs = cut();
    i = Math.max(0, i - 2);
  }
  return runs;
}

/** The route as one line per run, with its `kind`, for the layers that draw the arrows. */
export function directionToGeoJson(
  geometry: LngLat3[],
): FeatureCollection<LineString, { kind: DirectionKind }> {
  const features: Feature<LineString, { kind: DirectionKind }>[] =
    directionRuns(geometry).map((run) => ({
      type: 'Feature',
      properties: { kind: run.kind },
      geometry: {
        type: 'LineString',
        coordinates: geometry.slice(run.from, run.to + 1),
      },
    }));
  return { type: 'FeatureCollection', features };
}
