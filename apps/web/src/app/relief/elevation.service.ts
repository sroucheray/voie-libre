import { Injectable, inject } from '@angular/core';
import { API_CLIENT } from '../core/api/api-client';
import { climbOf } from '../import/gpx-import';
import type { LngLat3 } from '../planner/planner-map-driver';

/** Why elevations could not be read; the UI translates these under `relief.errors.*`. */
export type ElevationErrorCode =
  | 'elevation_network'
  | 'elevation_rate_limited'
  | 'elevation_unavailable'
  | 'elevation_no_data'
  | 'elevation_unknown';

export class ElevationError extends Error {
  constructor(readonly code: ElevationErrorCode) {
    super(`Elevation failed: ${code}`);
    this.name = 'ElevationError';
  }
}

/** Below this share of points with data, the terrain data does not cover the route. */
const MIN_COVERAGE = 0.8;

/** Fills the gaps (`null`) by interpolating along the track. Ends are copied from the nearest. */
export function fillGaps(values: readonly (number | null)[]): number[] {
  const known = values
    .map((value, index) => (value === null ? -1 : index))
    .filter((index) => index >= 0);
  return values.map((value, index) => {
    if (value !== null) return value;
    const before = known.filter((k) => k < index).at(-1);
    const after = known.find((k) => k > index);
    if (before === undefined) return values[after as number] as number;
    if (after === undefined) return values[before] as number;
    const ratio = (index - before) / (after - before);
    return (
      (values[before] as number) +
      ((values[after] as number) - (values[before] as number)) * ratio
    );
  });
}

/**
 * Elevations from the API's terrain data (Copernicus GLO-30), for a route whose file had none.
 * The only network use of the import, and only when the user asks for it.
 */
@Injectable({ providedIn: 'root' })
export class ElevationService {
  private readonly client = inject(API_CLIENT);

  /** The geometry with elevations, and the climb computed from them. */
  async forGeometry(
    geometry: readonly LngLat3[],
  ): Promise<{ geometry: LngLat3[]; ascentMeters: number }> {
    let result;
    try {
      result = await this.client.POST('/elevation', {
        body: { points: geometry.map(([lon, lat]) => ({ lon, lat })) },
      });
    } catch {
      throw new ElevationError('elevation_network');
    }
    const { data, response } = result;
    if (!data) {
      throw new ElevationError(
        response.status === 504
          ? 'elevation_network'
          : response.status === 429
            ? 'elevation_rate_limited'
            : response.status === 503
              ? 'elevation_unavailable'
              : 'elevation_unknown',
      );
    }
    const values = data.elevations;
    if (
      values.length !== geometry.length ||
      values.filter((v) => v !== null).length < values.length * MIN_COVERAGE
    ) {
      throw new ElevationError('elevation_no_data');
    }
    const filled = fillGaps(values);
    return {
      geometry: geometry.map(([lon, lat], i): LngLat3 => [lon, lat, filled[i]]),
      ascentMeters: climbOf(filled),
    };
  }
}
