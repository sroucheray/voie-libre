import type { LngLat } from './map-factory';
import type { Box } from '../offline/area-tiles';

/** Where the last view of the map is kept on the device. */
export const MAP_VIEW_KEY = 'voie-libre.map-view';

/** Metropolitan France with Corsica, a little wider than the land: the first view of a new visitor. */
export const FRANCE_BOX: Box = [-5.3, 41.3, 9.7, 51.2];

export interface StoredView {
  center: LngLat;
  zoom: number;
}

/** The view of the last visit, or `null` on the first one (or when what is stored makes no sense). */
export function readStoredView(): StoredView | null {
  try {
    const stored = JSON.parse(localStorage.getItem(MAP_VIEW_KEY) ?? 'null');
    const [lng, lat] = stored?.center ?? [];
    const zoom = stored?.zoom;
    const ok =
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Number.isFinite(zoom) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 85 &&
      zoom >= 0 &&
      zoom <= 24;
    return ok ? { center: [lng, lat], zoom } : null;
  } catch {
    return null;
  }
}

/** Keeps the view for the next visit; a refused storage only means the next visit starts afresh. */
export function storeView(center: LngLat, zoom: number): void {
  try {
    localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ center, zoom }));
  } catch {
    // Storage refused (private window): nothing to keep.
  }
}

const TILE = 512;

const mercatorX = (lng: number) => (lng + 180) / 360;
const mercatorY = (lat: number) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};
const lngOf = (x: number) => x * 360 - 180;
const latOf = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** The room the page leaves over the map, in pixels. */
export interface Reserved {
  left: number;
  top: number;
  bottom: number;
  right: number;
}

/**
 * The centre and the zoom that show all of `box` in a map `width` by `height` pixels, in the part
 * the page leaves free (`reserved`: the side panel, the sheet of a phone, the buttons). The zoom is
 * not rounded: the map keeps the whole box in sight on a phone as on a wide screen. A map with no
 * size (not laid out yet) gets the box's centre and a country-sized zoom.
 */
export function viewToFit(
  box: Box,
  width: number,
  height: number,
  reserved: Reserved = { left: 0, top: 0, bottom: 0, right: 0 },
): StoredView {
  const x0 = mercatorX(box[0]);
  const x1 = mercatorX(box[2]);
  const y0 = mercatorY(box[3]);
  const y1 = mercatorY(box[1]);
  const middle: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const usableWidth = width - reserved.left - reserved.right;
  const usableHeight = height - reserved.top - reserved.bottom;
  if (usableWidth <= 0 || usableHeight <= 0) {
    return { center: [lngOf(middle[0]), latOf(middle[1])], zoom: 5 };
  }
  const zoom = Math.min(
    Math.log2(usableWidth / (TILE * (x1 - x0))),
    Math.log2(usableHeight / (TILE * (y1 - y0))),
  );
  // The free part is not centred in the map: the box's middle must land in the middle of the free
  // part, so the map's centre sits that far (in pixels) the other way.
  const world = TILE * 2 ** zoom;
  const shiftX = (reserved.left - reserved.right) / 2;
  const shiftY = (reserved.top - reserved.bottom) / 2;
  const x = middle[0] - shiftX / world;
  const y = middle[1] - shiftY / world;
  return { center: [lngOf(x), latOf(y)], zoom };
}
