/** A WGS84 position in decimal degrees. */
export interface ElevationPosition {
  lon: number;
  lat: number;
}

/**
 * Gives the ground elevation of points. Sits behind an interface like routing, geocoding and
 * tiles: the data source (Copernicus tiles today) can change without touching the app.
 */
export interface ElevationProvider {
  /**
   * One elevation in meters per point, in the same order, or `null` where the source has no data
   * (outside the downloaded tiles, or no-data cells).
   */
  elevations(points: ElevationPosition[]): Promise<(number | null)[]>;
}
