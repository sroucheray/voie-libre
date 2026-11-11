import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  Marker,
} from 'maplibre-gl';
import type { LngLat, MapLike } from '../core/map/map-factory';
import type {
  GhostSpec,
  LngLat3,
  MarkerSpec,
  PlannerMapDriver,
  PlannerMapHandlers,
} from './planner-map-driver';
import { accuracyCircle } from '../location/accuracy-circle';
import type { LocationFix } from '../location/geolocation';
import { routesToGeoJson, surfacesToGeoJson } from './route-geojson';
import { PALETTE } from '../core/map/palette';
import { SURFACE_CODES, SURFACE_COLORS } from './route-surface';

const SOURCE = 'planner-routes';
const ALTERNATIVE_CASING_LAYER = 'planner-routes-alternative-casing';
const SELECTED_CASING_LAYER = 'planner-routes-selected-casing';
const ALTERNATIVE_LAYER = 'planner-routes-alternative';
const SELECTED_LAYER = 'planner-routes-selected';
const SURFACE_SOURCE = 'planner-surfaces';
const SURFACE_LAYER = 'planner-surfaces-line';
const HIGHLIGHT_SOURCE = 'planner-highlight';
const HIGHLIGHT_LAYER = 'planner-highlight-line';
const PREVIEW_SOURCE = 'planner-preview';
const PREVIEW_LAYER = 'planner-preview-line';
const ACCURACY_SOURCE = 'planner-location-accuracy';
const ACCURACY_FILL_LAYER = 'planner-location-accuracy-fill';
const ACCURACY_LINE_LAYER = 'planner-location-accuracy-line';
/** Zoom the view reaches when it first moves to the user (it never zooms out). */
const LOCATION_ZOOM = 15;
const PLACE_ZOOM = 14;

/** The circle of the accuracy as GeoJSON, empty without a fix. */
function accuracyData(fix: LocationFix | null): GeoJSON.GeoJSON {
  return fix
    ? accuracyCircle(fix.position, fix.accuracyMeters)
    : { type: 'FeatureCollection', features: [] };
}

/** Pixels around a click that still count as hitting an alternative route. */
const HIT_TOLERANCE = 6;
/** Pixels the mouse must move after a click before the ghost of the next point shows. */
const GHOST_MOVE_PX = 30;

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
  let locationFix: LocationFix | null = null;
  let locationMarker: Marker | null = null;
  let ghostSpec: GhostSpec | null = null;
  let ghostMarker: Marker | null = null;
  let ghostElement: HTMLElement | null = null;
  // The ghost follows a mouse; a finger has no position to show before it touches.
  const finePointer =
    typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  let destroyed = false;
  let dragging = false;
  /** A marker is being dragged: MapLibre moves it, so the markers are not drawn again meanwhile. */
  let markerDrag = false;
  let specs: MarkerSpec[] = [];
  /** Markers asked for during a drag, drawn when it ends. */
  let deferred = false;
  let preview: LngLat3[] | null = null;
  let highlight: LngLat3[] | null = null;
  let surfaceRoute: { geometry: LngLat3[]; surfaces: string } | null = null;

  /** Adds the source and layers. Idempotent: a new style (language change) removes them. */
  const ensureLayers = () => {
    if (destroyed || map.getSource(SOURCE)) return;
    // The accuracy circle goes under the routes, which are added right after it.
    map.addSource(ACCURACY_SOURCE, {
      type: 'geojson',
      data: accuracyData(locationFix),
    });
    map.addLayer({
      id: ACCURACY_FILL_LAYER,
      type: 'fill',
      source: ACCURACY_SOURCE,
      paint: { 'fill-color': PALETTE.location, 'fill-opacity': 0.14 },
    });
    map.addLayer({
      id: ACCURACY_LINE_LAYER,
      type: 'line',
      source: ACCURACY_SOURCE,
      paint: {
        'line-color': PALETTE.location,
        'line-opacity': 0.4,
        'line-width': 1,
      },
    });
    map.addSource(SOURCE, { type: 'geojson', data: routesToGeoJson([], 0) });
    // Each line has a white halo under it (its casing) and grows with the zoom: at a high zoom the
    // ways of the profile and the photos are drawn thick, and a thin grey line vanishes on them.
    // The selected route and its halo come after the alternatives, so they win where they overlap.
    const roundLine = { 'line-cap': 'round', 'line-join': 'round' } as const;
    const widthAt = (small: number, large: number): ExpressionSpecification => [
      'interpolate',
      ['linear'],
      ['zoom'],
      8,
      small,
      14,
      large,
      19,
      large * 1.5,
    ];
    map.addLayer({
      id: ALTERNATIVE_CASING_LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'selected'], false],
      layout: roundLine,
      paint: {
        'line-color': PALETTE.routeCasing,
        'line-width': widthAt(5, 9),
      },
    });
    map.addLayer({
      id: ALTERNATIVE_LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'selected'], false],
      layout: roundLine,
      paint: {
        'line-color': PALETTE.routeAlternative,
        'line-width': widthAt(3, 6),
      },
    });
    map.addLayer({
      id: SELECTED_CASING_LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'selected'], true],
      layout: roundLine,
      paint: {
        'line-color': PALETTE.routeCasing,
        'line-width': widthAt(6, 10),
      },
    });
    map.addLayer({
      id: SELECTED_LAYER,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'selected'], true],
      layout: roundLine,
      paint: { 'line-color': PALETTE.route, 'line-width': widthAt(4, 7) },
    });
    map.addSource(SURFACE_SOURCE, {
      type: 'geojson',
      data: surfacesToGeoJson([], ''),
    });
    // Over the route's own line, under the stretch highlighted from the chart.
    map.addLayer({
      id: SURFACE_LAYER,
      type: 'line',
      source: SURFACE_SOURCE,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'code'],
          ...SURFACE_CODES.flatMap((code) => [code, SURFACE_COLORS[code]]),
          SURFACE_COLORS['?'],
        ] as unknown as ExpressionSpecification,
        'line-width': 6,
      },
    });
    map.addSource(HIGHLIGHT_SOURCE, {
      type: 'geojson',
      data: routesToGeoJson(highlight ? [highlight] : [], 0),
    });
    // Over the route, which keeps its colour either side of the stretch.
    map.addLayer({
      id: HIGHLIGHT_LAYER,
      type: 'line',
      source: HIGHLIGHT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': PALETTE.routeHighlight, 'line-width': 6 },
    });
    map.addSource(PREVIEW_SOURCE, {
      type: 'geojson',
      data: routesToGeoJson(preview ? [preview] : [], 0),
    });
    map.addLayer({
      id: PREVIEW_LAYER,
      type: 'line',
      source: PREVIEW_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.routePreview,
        'line-width': 5,
        'line-opacity': 0.9,
      },
    });
    pushRoutes();
    pushSurfaces();
  };

  const pushSurfaces = () => {
    const source = map.getSource(SURFACE_SOURCE) as
      { setData(data: unknown): void } | undefined;
    source?.setData(
      surfaceRoute
        ? surfacesToGeoJson(surfaceRoute.geometry, surfaceRoute.surfaces)
        : surfacesToGeoJson([], ''),
    );
  };

  const pushPreview = () => {
    const source = map.getSource(PREVIEW_SOURCE) as
      { setData(data: unknown): void } | undefined;
    source?.setData(routesToGeoJson(preview ? [preview] : [], 0));
  };

  const pushHighlight = () => {
    const source = map.getSource(HIGHLIGHT_SOURCE) as
      { setData(data: unknown): void } | undefined;
    source?.setData(routesToGeoJson(highlight ? [highlight] : [], 0));
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

  /**
   * The cursor on the map says what a click does: a cross where it creates a point (the ghost is
   * shown), a pointer on the selected route (see `styles.scss`), the usual hand elsewhere.
   */
  const setAiming = (aiming: boolean) =>
    map.getCanvasContainer().classList.toggle('planner-aiming', aiming);

  const hideGhost = () => {
    if (ghostElement) ghostElement.style.display = 'none';
    setAiming(false);
  };

  // Where the last click was: the ghost of the next point waits for a short move away from it.
  let clickedAt: { x: number; y: number } | null = null;
  map.on('click', (event: { point: { x: number; y: number } }) => {
    clickedAt = { x: event.point.x, y: event.point.y };
    if (ghostElement) ghostElement.style.display = 'none';
  });

  /** Moves the ghost under the pointer, unless it is over a marker or an alternative route. */
  const moveGhost = (event: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
    originalEvent?: MouseEvent;
  }) => {
    if (!ghostSpec || !finePointer || !ghostMarker || !ghostElement) return;
    // The marker being dragged trails the pointer: no ghost of the next point meanwhile.
    if (dragging) {
      hideGhost();
      return;
    }
    const target = event.originalEvent?.target as Element | null | undefined;
    if (target?.closest?.('.planner-marker')) {
      hideGhost();
      return;
    }
    const { x, y } = event.point;
    if (clickedAt) {
      if (Math.hypot(x - clickedAt.x, y - clickedAt.y) < GHOST_MOVE_PX) return;
      clickedAt = null;
    }
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
    setAiming(true);
    // The ghost sits where the point will land: on the nearest way, for a profile that needs one.
    const landing = handlers.ghostAt([event.lngLat.lng, event.lngLat.lat]);
    ghostElement.classList.toggle('planner-ghost--refused', landing.refused);
    ghostMarker.setLngLat(landing.point);
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

  /** Stops following the pointer; gives back the drag that was in progress, if any. */
  const releaseRouteDrag = () => {
    const drag = routeDrag;
    routeDrag = null;
    if (!drag) return null;
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
    }
    return drag;
  };

  const endRouteDrag = () => {
    const drag = releaseRouteDrag();
    if (!drag?.marker) return;
    handlers.onInsertPoint(drag.from, drag.last);
    queueMicrotask(drawDeferred);
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
      handlers.onDragStart();
    }
    drag.marker.setLngLat(drag.last);
    handlers.onDragInsert(drag.from, drag.last);
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

  /**
   * Right click, or long press on a touch screen (MapLibre reports both as a context menu): the
   * menu to place a point. A route press that turns into a long press is not a drag.
   */
  const LONG_PRESS_MS = 600;
  const onContextMenu = (event: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
    originalEvent?: MouseEvent;
  }) => {
    const target = event.originalEvent?.target as Element | null | undefined;
    if (target?.closest?.('.planner-marker')) return;
    event.originalEvent?.preventDefault();
    endRouteDrag();
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    handlers.onContextMenu([event.lngLat.lng, event.lngLat.lat], event.point);
  };
  map.on('contextmenu', onContextMenu);

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
    map.getCanvasContainer().classList.toggle('planner-on-route', hit);
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

  /** Right click and long press may both report the same gesture: remove only once. */
  let removedAt = 0;
  const requestRemove = (index: number) => {
    if (Date.now() - removedAt < 800) return;
    removedAt = Date.now();
    handlers.onRemovePoint(index);
  };

  const clearMarkers = () => {
    markers.forEach((marker) => marker.remove());
    markers = [];
  };

  /** Draws the markers asked for while a drag was in progress. */
  const drawDeferred = () => {
    if (!deferred || destroyed) return;
    deferred = false;
    drawMarkers();
  };

  const drawMarkers = () => {
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
        requestRemove(index);
      });
      // Long press removes it on a touch screen (see the map's own long press above).
      let markerPress: ReturnType<typeof setTimeout> | undefined;
      const stopPress = () => {
        clearTimeout(markerPress);
        markerPress = undefined;
      };
      element.addEventListener(
        'touchstart',
        () => {
          stopPress();
          markerPress = setTimeout(() => {
            markerPress = undefined;
            if (!dragging) requestRemove(index);
          }, LONG_PRESS_MS);
        },
        { passive: true },
      );
      element.addEventListener('touchmove', stopPress, { passive: true });
      element.addEventListener('touchend', stopPress);
      element.addEventListener('touchcancel', stopPress);
      const marker = new maplibre.Marker({
        element,
        draggable: true,
        clickTolerance: 5,
      })
        .setLngLat(spec.lngLat)
        .addTo(map);
      marker.on('dragstart', () => {
        dragging = true;
        markerDrag = true;
        hideGhost();
        handlers.onDragStart();
      });
      marker.on('drag', () => {
        const { lng, lat } = marker.getLngLat();
        handlers.onDragPoint(index, [lng, lat] as LngLat);
      });
      marker.on('dragend', () => {
        // The click that ends a drag must not count as a click on the marker.
        setTimeout(() => (dragging = false), 0);
        markerDrag = false;
        const { lng, lat } = marker.getLngLat();
        handlers.onMovePoint(index, [lng, lat] as LngLat);
        queueMicrotask(drawDeferred);
      });
      return marker;
    });
  };

  return {
    setMarkers(next: MarkerSpec[]) {
      specs = next;
      // The route changes under a drag: drawing the markers again would end it.
      if (markerDrag || routeDrag?.marker) deferred = true;
      else drawMarkers();
    },
    metersPerPixel(at: LngLat) {
      // MapLibre draws the world on 512 px at zoom 0.
      return (
        (40_075_016.686 * Math.cos((at[1] * Math.PI) / 180)) /
        (512 * 2 ** map.getZoom())
      );
    },
    cancelDrag() {
      releaseRouteDrag();
      if (markerDrag) {
        markerDrag = false;
        setTimeout(() => (dragging = false), 0);
      }
      // Removing the marker being dragged is what makes MapLibre let go of it.
      deferred = false;
      drawMarkers();
    },
    setRoutes(next: LngLat3[][], nextSelected: number) {
      routes = next;
      selected = nextSelected;
      pushRoutes();
    },
    setSurfaces(geometry: LngLat3[] | null, surfaces: string | null) {
      surfaceRoute =
        geometry && surfaces !== null ? { geometry, surfaces } : null;
      pushSurfaces();
    },
    setPreview(geometry: LngLat3[] | null) {
      preview = geometry;
      pushPreview();
    },
    setHighlight(geometry: LngLat3[] | null) {
      highlight = geometry;
      pushHighlight();
    },
    fitRoute(geometry: LngLat3[]) {
      if (geometry.length === 0) return;
      const bounds = new maplibre.LngLatBounds();
      for (const [lon, lat] of geometry) bounds.extend([lon, lat]);
      // Keep the route clear of the panel, but never ask for more padding than the map has.
      const width = map.getContainer().clientWidth;
      // On a phone the panel is a bottom sheet (open or not): leave room under the route instead.
      const phone = width <= 640;
      map.fitBounds(bounds, {
        padding: phone
          ? { top: 50, bottom: 260, right: 40, left: 40 }
          : {
              top: 50,
              bottom: 50,
              right: 50,
              left: Math.min(340, Math.round(width / 3)),
            },
        duration: 0,
        maxZoom: 16,
      });
    },
    centerOn(point: LngLat) {
      const width = map.getContainer().clientWidth;
      map.easeTo({
        center: point,
        zoom: Math.max(map.getZoom(), PLACE_ZOOM),
        padding: { left: Math.min(340, Math.round(width / 3)) },
        duration: 600,
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
          // To the right of the cross-shaped cursor, which would hide it.
          anchor: 'left',
          offset: [16, 0],
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
    setLocation(fix: LocationFix | null) {
      const first = !locationFix && !!fix;
      locationFix = fix;
      const circle = map.getSource(ACCURACY_SOURCE) as
        { setData(data: unknown): void } | undefined;
      circle?.setData(accuracyData(fix));
      if (!fix) {
        locationMarker?.remove();
        locationMarker = null;
        return;
      }
      if (!locationMarker) {
        const element = document.createElement('div');
        element.className = 'planner-location';
        element.setAttribute('aria-hidden', 'true');
        locationMarker = new maplibre.Marker({
          element,
          rotationAlignment: 'map',
          pitchAlignment: 'map',
        })
          .setLngLat(fix.position)
          .addTo(map);
      }
      locationMarker.setLngLat(fix.position);
      // A cone points where the user heads; it is hidden while the heading is unknown.
      locationMarker
        .getElement()
        .classList.toggle('planner-location--heading', fix.heading !== null);
      locationMarker.setRotation(fix.heading ?? 0);
      if (first) {
        map.easeTo({
          center: fix.position,
          zoom: Math.max(map.getZoom(), LOCATION_ZOOM),
          duration: 600,
        });
      }
    },
    destroy() {
      destroyed = true;
      locationMarker?.remove();
      locationMarker = null;
      clearMarkers();
      cursorMarker?.remove();
      cursorMarker = null;
      ghostMarker?.remove();
      ghostMarker = null;
      container.removeEventListener('mouseleave', hideGhost);
      map.off('mousemove', moveGhost);
      map.off('contextmenu', onContextMenu);
      map.off('mousedown', startRouteDrag);
      map.off('touchstart', startRouteDrag);
      endRouteDrag();
      map.off('mousemove', onMouseMove);
      map.off('styledata', onStyleData);
      map.off('click', onClick);
      for (const id of [
        PREVIEW_LAYER,
        HIGHLIGHT_LAYER,
        SURFACE_LAYER,
        SELECTED_LAYER,
        SELECTED_CASING_LAYER,
        ALTERNATIVE_LAYER,
        ALTERNATIVE_CASING_LAYER,
        ACCURACY_LINE_LAYER,
        ACCURACY_FILL_LAYER,
      ]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [
        SOURCE,
        SURFACE_SOURCE,
        HIGHLIGHT_SOURCE,
        PREVIEW_SOURCE,
        ACCURACY_SOURCE,
      ]) {
        if (map.getSource(id)) map.removeSource(id);
      }
    },
  };
}
