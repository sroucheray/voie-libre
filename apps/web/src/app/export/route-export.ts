import { buildGpx, gpxFileName } from '@voie-libre/shared';
import { buildFit, fitFileName, type FitSource } from './fit';
import { repeatGeometry } from './laps';

/** The two file formats a route can be exported to. */
export const EXPORT_FORMATS = ['gpx', 'fit'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** A route as the files are built from it (the same fields as a saved route's). */
export type ExportableRoute = FitSource;

export interface ExportFile {
  /** Text (GPX) or bytes (FIT). */
  content: string | Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType: string;
}

/**
 * Builds the file of a route on the device. `pointNames` is one translated name per point (start,
 * waypoints, end); `laps` repeats a loop. Throws if the route cannot make a file.
 */
export function buildExportFile(
  route: ExportableRoute,
  format: ExportFormat,
  pointNames: readonly string[],
  laps = 1,
): ExportFile {
  if (format === 'fit') {
    return {
      content: buildFit(route, pointNames.slice(1, -1), laps),
      fileName: fitFileName(route.name),
      mimeType: 'application/vnd.ant.fit',
    };
  }
  return {
    content: buildGpx(
      {
        ...route,
        geometry: repeatGeometry(route.geometry, laps),
        withElevation: route.ascentMeters !== null,
      },
      pointNames,
    ),
    fileName: gpxFileName(route.name),
    mimeType: 'application/gpx+xml',
  };
}
