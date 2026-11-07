/** The parts of a route a GPX file is built from. */
export interface GpxSource {
  name: string;
  /** `[longitude, latitude]` of the start, the waypoints and the end. */
  points: readonly (readonly [number, number])[];
  /** `[longitude, latitude, elevation in meters]` per point of the itinerary. */
  geometry: readonly (readonly [number, number, number])[];
  /** Milliseconds since the epoch. */
  createdAt: number;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escapes text for XML and drops the control characters XML 1.0 cannot carry. */
export function escapeXml(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/[&<>"']/g, (char) => XML_ESCAPES[char])
  );
}

/**
 * A GPX 1.1 document: one `<wpt>` per route point (start, waypoints, end) and one track of one
 * segment. `lat`/`lon` to 6 decimals (about 10 cm), elevation to 1 decimal. Built on the device
 * from the stored route, never from the network.
 *
 * `pointNames` holds one already translated name per entry of `route.points`, in the language
 * of the user at export time. The schema wants `<wpt>` before `<trk>`.
 */
export function buildGpx(
  route: GpxSource,
  pointNames: readonly string[],
): string {
  const waypoints = route.points
    .map(
      ([lon, lat], index) =>
        `  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><name>${escapeXml(pointNames[index] ?? '')}</name></wpt>\n`,
    )
    .join('');
  const points = route.geometry
    .map(
      ([lon, lat, ele]) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
    )
    .join('\n');
  const name = escapeXml(route.name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Voie Libre" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <time>${new Date(route.createdAt).toISOString()}</time>
  </metadata>
${waypoints}  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** `Col de la Ventouse` becomes `col-de-la-ventouse.gpx`: ASCII, safe on every file system. */
export function gpxFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${slug || 'route'}.gpx`;
}

const POINT_NAMES = {
  en: { start: 'Start', end: 'End', waypoint: 'Waypoint' },
  fr: { start: 'Départ', end: 'Arrivée', waypoint: 'Étape' },
} as const;

export type GpxLanguage = keyof typeof POINT_NAMES;

export const GPX_LANGUAGES = Object.keys(POINT_NAMES) as GpxLanguage[];

/**
 * Names of the waypoints of a route with `count` points, for GPX files built where there is no
 * translation layer (the API). The web app uses its own translation keys: a test keeps both in
 * step.
 */
export function gpxPointNames(language: GpxLanguage, count: number): string[] {
  const names = POINT_NAMES[language];
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? names.start
      : index === count - 1
        ? names.end
        : `${names.waypoint} ${index}`,
  );
}
