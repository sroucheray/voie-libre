import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { LngLat, MapLike } from '../core/map/map-factory';
import type {
  GhostSpec,
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
  let ghostSpec: GhostSpec | null = null;
  let ghostMarker: Marker | null = null;
  let ghostElement: HTMLElement | null = null;
  // The ghost follows a mouse; a finger has no position to show before it touches.
  const finePointer =
    typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  let destroyed = false;
  let dragging = false;

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
    if (suppressClick) return;
    // A marker lies over the map: its own handlers deal with the click.
    const target = (event as { originalEvent?: MouseEvent }).originalEvent
      ?.target as Element | null | undefined;
    if (target?.closest?.('.planner-marker')) return;
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

  const hideGhost = () => {
    if (ghostElement) ghostElement.style.display = 'none';
  };

  /** Moves the ghost under the pointer, unless it is over a marker or an alternative route. */
  const moveGhost = (event: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
    originalEvent?: MouseEvent;
  }) => {
    if (!ghostSpec || !finePointer || !ghostMarker || !ghostElement) return;
    const target = event.originalEvent?.target as Element | null | undefined;
    if (target?.closest?.('.planner-marker')) {
      hideGhost();
      return;
    }
    const { x, y } = event.point;
    const overAlternative =
      !!map.getLayer(ALTERNATIVE_LAYER) &&
      map.queryRenderedFeatures(
        [
          [x - HIT_TOLERANCE, y - HIT_TOLERANCE],
          [x + HIT_TOLERANCE, y + HIT_TOLERANCE],
        ],
        { layers: [ALTERNATIVE_LAYER] },
      ).length > 0;
    if (overAlternative) {
      hideGhost();
      return;
    }
    ghostElement.style.display = '';
    ghostMarker.setLngLat([event.lngLat.lng, event.lngLat.lat]);
  };
  const container = map.getCanvasContainer();
  container.addEventListener('mouseleave', hideGhost);
  map.on('mousemove', moveGhost);

  /**
   * Dragging the selected route drops a waypoint where the user lets go. The press is claimed
   * from the map only when it starts on the route; a press that does not move stays a click.
   */
  const DRAG_THRESHOLD = 6;
  const TOUCH_TOLERANCE = 14;
  let routeDrag: {
    from: LngLat;
    x: number;
    y: number;
    last: LngLat;
    marker: Marker | null;
  } | null = null;
  let suppressClick = false;

  const endRouteDrag = () => {
    const drag = routeDrag;
    routeDrag = null;
    if (!drag) return;
    map.off('mousemove', moveRouteDrag);
    map.off('touchmove', moveRouteDrag);
    map.off('mouseup', endRouteDrag);
    map.off('touchend', endRouteDrag);
    map.off('touchcancel', endRouteDrag);
    drag.marker?.remove();
    if (drag.marker) {
      // The click that follows the drop must not add a point on top of the inserted one.
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 50);
      handlers.onInsertPoint(drag.from, drag.last);
    }
  };

  const moveRouteDrag = (event: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
  }) => {
    const drag = routeDrag;
    if (!drag) return;
    drag.last = [event.lngLat.lng, event.lngLat.lat];
    const moved = Math.hypot(event.point.x - drag.x, event.point.y - drag.y);
    if (!drag.marker && moved < DRAG_THRESHOLD) return;
    if (!drag.marker) {
      const element = document.createElement('div');
      element.className =
        'planner-marker planner-marker--waypoint planner-marker--dragging';
      element.setAttribute('aria-hidden', 'true');
      drag.marker = new maplibre.Marker({ element })
        .setLngLat(drag.last)
        .addTo(map);
      hideGhost();
    }
    drag.marker.setLngLat(drag.last);
  };

  const startRouteDrag = (event: {
    type: string;
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
    originalEvent?: MouseEvent | TouchEvent;
    preventDefault(): void;
  }) => {
    if (routeDrag || !map.getLayer(SELECTED_LAYER)) return;
    const touch = event.type === 'touchstart';
    if (touch && (event.originalEvent as TouchEvent).touches?.length > 1)
      return;
    const target = event.originalEvent?.target as Element | null | undefined;
    if (target?.closest?.('.planner-marker')) return;
    const { x, y } = event.point;
    const tolerance = touch ? TOUCH_TOLERANCE : HIT_TOLERANCE;
    const onRoute =
      map.queryRenderedFeatures(
        [
          [x - tolerance, y - tolerance],
          [x + tolerance, y + tolerance],
        ],
        { layers: [SELECTED_LAYER] },
      ).length > 0;
    if (!onRoute) return;
    // Keeps the map from panning while the route is being dragged.
    event.preventDefault();
    const from: LngLat = [event.lngLat.lng, event.lngLat.lat];
    routeDrag = { from, x, y, last: from, marker: null };
    map.on('mousemove', moveRouteDrag);
    map.on('touchmove', moveRouteDrag);
    map.on('mouseup', endRouteDrag);
    map.on('touchend', endRouteDrag);
    map.on('touchcancel', endRouteDrag);
  };
  map.on('mousedown', startRouteDrag);
  map.on('touchstart', startRouteDrag);

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
        element.className = `planner-marker planner-marker--${spec.role}${spec.loop ? ' planner-marker--loop' : ''}`;
        element.textContent = spec.label;
        if (spec.closable) {
          // The start marker invites to close the loop: it grows under the pointer (the magnet).
          element.classList.add('planner-marker--closable');
          element.dataset['hint'] = spec.closable;
          element.setAttribute('role', 'button');
          element.setAttribute(
            'aria-label',
            `${spec.ariaLabel}: ${spec.closable}`,
          );
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!dragging) handlers.onCloseLoop();
          });
        } else {
          element.setAttribute('role', 'img');
          element.setAttribute('aria-label', spec.ariaLabel);
        }
        // Right click removes the point (the panel offers a button too).
        element.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          handlers.onRemovePoint(index);
        });
        const marker = new maplibre.Marker({ element, draggable: true })
          .setLngLat(spec.lngLat)
          .addTo(map);
        marker.on('dragstart', () => {
          dragging = true;
        });
        marker.on('dragend', () => {
          // The click that ends a drag must not count as a click on the marker.
          setTimeout(() => (dragging = false), 0);
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
    setGhost(spec: GhostSpec | null) {
      ghostSpec = spec;
      if (!spec || !finePointer) {
        ghostMarker?.remove();
        ghostMarker = null;
        ghostElement = null;
        return;
      }
      if (!ghostMarker) {
        ghostElement = document.createElement('div');
        ghostElement.className = 'planner-ghost';
        ghostElement.setAttribute('aria-hidden', 'true');
        ghostElement.style.display = 'none';
        ghostMarker = new maplibre.Marker({
          element: ghostElement,
          anchor: 'left',
          offset: [-14, 0],
        })
          .setLngLat([0, 0])
          .addTo(map);
      }
      const element = ghostElement;
      if (!element) return;
      element.innerHTML = '';
      const dot = document.createElement('span');
      dot.className = `planner-marker planner-marker--${spec.role} planner-ghost__dot`;
      dot.textContent = spec.label;
      const text = document.createElement('span');
      text.className = 'planner-ghost__text';
      text.textContent = spec.text;
      element.append(dot, text);
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
      ghostMarker?.remove();
      ghostMarker = null;
      container.removeEventListener('mouseleave', hideGhost);
      map.off('mousemove', moveGhost);
      map.off('mousedown', startRouteDrag);
      map.off('touchstart', startRouteDrag);
      endRouteDrag();
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
