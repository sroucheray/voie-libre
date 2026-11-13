/**
 * Every colour the map and the charts draw, defined once. MapLibre paints and chart inline styles
 * cannot read CSS custom properties, so the same values also sit in the `:root` block of
 * `styles.scss` (see `PALETTE_TOKENS`); `palette.spec.ts` fails when the two drift apart.
 *
 * The sets of ways, surface and grade were checked for colour-blind safety (Viénot simulation of
 * protanopia, deuteranopia and tritanopia, CIE Lab distance; see `docs/design-tokens.md`): the ways
 * to avoid are also dashed, so colour is never the only signal.
 */
export const PALETTE = {
  /** The route being planned, and what points at it (the cursor on the profile, the accuracy of a fix). */
  route: '#0e7490',
  routeAlternative: '#667085',
  /** A white halo under every route line, so it stands out on any colour (ways, photos, relief). */
  routeCasing: '#ffffff',
  routeHighlight: '#0f2420',
  routePreview: '#f79009',
  location: '#1a73e8',

  markerStart: '#067647',
  markerEnd: '#b42318',
  markerWaypoint: '#0e7490',

  /** How well a way suits the profile (`way-levels.ts`). */
  way: {
    good: '#039855',
    fair: '#fec84b',
    avoid: '#b42318',
  },

  /** What a stretch of the route rides on (`surface-categories.ts`). */
  surface: {
    p: '#667085',
    c: '#2e90fa',
    u: '#f79009',
    s: '#7a2e0e',
    unknown: '#d0d5dd',
  },

  /** Grade bands, nearly flat to very steep (`GRADE_BANDS` in `elevation-profile.ts`). */
  grade: ['#d1e9ff', '#a6e3b8', '#fde272', '#f79009', '#b42318'],

  /** The same bands for the route line on the map, the first one deeper so that it shows on the map. */
  gradeLine: ['#6aaef0', '#4cb87a', '#f2c200', '#f79009', '#b42318'],

  /** The hillshade of the relief. */
  hillshade: {
    shadow: '#4b5563',
    highlight: '#ffffff',
    accent: '#6b7280',
  },
} as const;

/** The same colours as the CSS custom properties of `styles.scss`, by name. */
export const PALETTE_TOKENS: Record<string, string> = {
  '--map-route': PALETTE.route,
  '--map-route-alternative': PALETTE.routeAlternative,
  '--map-route-casing': PALETTE.routeCasing,
  '--map-route-highlight': PALETTE.routeHighlight,
  '--map-route-preview': PALETTE.routePreview,
  '--map-location': PALETTE.location,
  '--map-marker-start': PALETTE.markerStart,
  '--map-marker-end': PALETTE.markerEnd,
  '--map-marker-waypoint': PALETTE.markerWaypoint,
  '--way-good': PALETTE.way.good,
  '--way-fair': PALETTE.way.fair,
  '--way-avoid': PALETTE.way.avoid,
  '--surface-paved': PALETTE.surface.p,
  '--surface-cycleway': PALETTE.surface.c,
  '--surface-unpaved': PALETTE.surface.u,
  '--surface-path': PALETTE.surface.s,
  '--surface-unknown': PALETTE.surface.unknown,
  ...Object.fromEntries(PALETTE.grade.map((c, i) => [`--grade-${i}`, c])),
};
