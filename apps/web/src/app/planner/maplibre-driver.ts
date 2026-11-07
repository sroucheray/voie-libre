import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { LngLat, MapLike } from '../core/map/map-factory';
import type {
  LngLat3,
  MarkerSpec,
  PlannerMapDriver,
  PlannerMapHandlers,
} from './planner-map-driver';
import { routesToGeoJson } from './route-geojson';

const SOURCE = 'planner-routes';
const ALTERNATIVE_LAYER = 'planner-routes-alternative';
const SELECTED_LAYER = 'planner-routes-selected';
/** Pixels around a click that still count as hitting an alternative route. */
const HIT_TOLERANCE = 6;

/**
 * Draws the planner on the real MapLibre map: draggable DOM markers and a GeoJSON source with two
 * line layers. MapLibre is imported on demand, like in {@link createMapLibreMap}.
 */
export async function createMapLibreDriver(
  mapLike: MapLike,
  handlers: PlannerMapHandlers,
): Promise<PlannerMapDriver> {
  const maplibre = await import('maplibre-gl');
  // The MapView creates a real MapLibre map: MapLike is only the narrow type tests can fake.
  const map = mapLike as unknown as MapLibreMap;

  if (!map.isStyleLoaded()) {
    await new Promise<void>((resolve) => map.once('load', () => resolve()));
  }

  let routes: LngLat3[][] = [];
  let selected = 0;
  let markers: Marker[] = [];
  let cursorMarker: Marker | null = null;
  let destroyed = false;

  /** Adds the source and layers. Idempotent: a new style (language change) removes them. */
  const ensureLayers = () => {
    if (destroyed || map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: routesToGeoJson([], 0) });
    map.addLayer({
      id: ALTERNATIVE_LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'selected'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#98a2b3', 'line-width': 5, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: SELECTED_LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'selected'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1570ef', 'line-width': 6 },
    });
    pushRoutes();
  };

  const pushRoutes = () => {
    const source = map.getSource(SOURCE) as
      { setData(data: unknown): void } | undefined;
    source?.setData(routesToGeoJson(routes, selected));
  };

  const onStyleData = () => ensureLayers();
  const onClick = (event: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
  }) => {
    const { x, y } = event.point;
    const hits = map.getLayer(ALTERNATIVE_LAYER)
      ? map.queryRenderedFeatures(
          [
            [x - HIT_TOLERANCE, y - HIT_TOLERANCE],
            [x + HIT_TOLERANCE, y + HIT_TOLERANCE],
          ],
          { layers: [ALTERNATIVE_LAYER] },
        )
      : [];
    if (hits.length > 0) {
      handlers.onSelectRoute(Number(hits[0].properties?.['index']));
    } else {
      handlers.onClick([event.lngLat.lng, event.lngLat.lat]);
    }
  };

  /** Hovering the selected route tells the planner where, to show the point on the profile. */
  let hovering = false;
  const onMouseMove = (event: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
  }) => {
    const { x, y } = event.point;
    const hit =
      !!map.getLayer(SELECTED_LAYER) &&
      map.queryRenderedFeatures(
        [
          [x - HIT_TOLERANCE, y - HIT_TOLERANCE],
          [x + HIT_TOLERANCE, y + HIT_TOLERANCE],
        ],
        { layers: [SELECTED_LAYER] },
      ).length > 0;
    if (hit) {
      hovering = true;
      handlers.onHoverRoute([event.lngLat.lng, event.lngLat.lat]);
    } else if (hovering) {
      hovering = false;
      handlers.onHoverRoute(null);
    }
  };

  map.on('styledata', onStyleData);
  map.on('click', onClick);
  map.on('mousemove', onMouseMove);
  ensureLayers();

  const clearMarkers = () => {
    markers.forEach((marker) => marker.remove());
    markers = [];
  };

  return {
    setMarkers(specs: MarkerSpec[]) {
      clearMarkers();
      markers = specs.map((spec, index) => {
        const element = document.createElement('div');
        element.className = `planner-marker planner-marker--${spec.role}`;
        element.textContent = spec.label;
        element.setAttribute('role', 'img');
        element.setAttribute('aria-label', spec.ariaLabel);
        // Right click removes the point (the panel offers a button too).
        element.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          handlers.onRemovePoint(index);
        });
        const marker = new maplibre.Marker({ element, draggable: true })
          .setLngLat(spec.lngLat)
          .addTo(map);
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          handlers.onMovePoint(index, [lng, lat] as LngLat);
        });
        return marker;
      });
    },
    setRoutes(next: LngLat3[][], nextSelected: number) {
      routes = next;
      selected = nextSelected;
      pushRoutes();
    },
    fitRoute(geometry: LngLat3[]) {
      if (geometry.length === 0) return;
      const bounds = new maplibre.LngLatBounds();
      for (const [lon, lat] of geometry) bounds.extend([lon, lat]);
      // Keep the route clear of the panel, but never ask for more padding than the map has.
      const width = map.getContainer().clientWidth;
      map.fitBounds(bounds, {
        padding: {
          top: 50,
          bottom: 50,
          right: 50,
          left: Math.min(340, Math.round(width / 3)),
        },
        duration: 0,
        maxZoom: 16,
      });
    },
    setCursor(point: LngLat | null) {
      if (!point) {
        cursorMarker?.remove();
        cursorMarker = null;
        return;
      }
      if (!cursorMarker) {
        const element = document.createElement('div');
        element.className = 'planner-cursor';
        element.setAttribute('aria-hidden', 'true');
        cursorMarker = new maplibre.Marker({ element }).setLngLat(point);
        cursorMarker.addTo(map);
      } else {
        cursorMarker.setLngLat(point);
      }
    },
    destroy() {
      destroyed = true;
      clearMarkers();
      cursorMarker?.remove();
      cursorMarker = null;
      map.off('mousemove', onMouseMove);
      map.off('styledata', onStyleData);
      map.off('click', onClick);
      for (const id of [SELECTED_LAYER, ALTERNATIVE_LAYER]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    },
  };
}
