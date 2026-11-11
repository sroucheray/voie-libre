import type { LocationFix } from '../app/location/geolocation';
import {
  GhostSpec,
  LngLat3,
  MarkerSpec,
  PLANNER_MAP_DRIVER,
  PlannerMapDriver,
  PlannerMapDriverFactory,
  PlannerMapHandlers,
} from '../app/planner/planner-map-driver';

/** A planner driver that records what is drawn and exposes the handlers, to simulate the user. */
export class FakePlannerDriver implements PlannerMapDriver {
  markers: MarkerSpec[] = [];
  routes: LngLat3[][] = [];
  selected = 0;
  fitted: LngLat3[][] = [];
  pointsFitted: [number, number][][] = [];
  centered: [number, number][] = [];
  cursor: [number, number] | null = null;
  ghost: GhostSpec | null = null;
  location: LocationFix | null = null;
  preview: LngLat3[] | null = null;
  highlight: LngLat3[] | null = null;
  cancelledDrags = 0;
  /** Ground meters per pixel reported to the planner (about zoom 13 by default). */
  scale = 10;
  destroyed = false;

  constructor(readonly handlers: PlannerMapHandlers) {}

  setMarkers(markers: MarkerSpec[]) {
    this.markers = markers;
  }
  surfaces: { geometry: LngLat3[]; surfaces: string } | null = null;
  setSurfaces(geometry: LngLat3[] | null, surfaces: string | null) {
    this.surfaces =
      geometry && surfaces !== null ? { geometry, surfaces } : null;
  }
  setRoutes(routes: LngLat3[][], selected: number) {
    this.routes = routes;
    this.selected = selected;
  }
  fitRoute(geometry: LngLat3[]) {
    this.fitted.push(geometry);
  }
  fitPoints(points: [number, number][]) {
    this.pointsFitted.push(points);
  }
  centerOn(point: [number, number]) {
    this.centered.push(point);
  }
  setGhost(ghost: GhostSpec | null) {
    this.ghost = ghost;
  }
  setCursor(point: [number, number] | null) {
    this.cursor = point;
  }
  setPreview(geometry: LngLat3[] | null) {
    this.preview = geometry;
  }
  setHighlight(geometry: LngLat3[] | null) {
    this.highlight = geometry;
  }
  setLocation(fix: LocationFix | null) {
    this.location = fix;
  }
  metersPerPixel() {
    return this.scale;
  }
  cancelDrag() {
    this.cancelledDrags++;
  }
  destroy() {
    this.destroyed = true;
  }
}

export function provideFakePlannerDriver(drivers: FakePlannerDriver[] = []) {
  const factory: PlannerMapDriverFactory = async (_map, handlers) => {
    const driver = new FakePlannerDriver(handlers);
    drivers.push(driver);
    return driver;
  };
  return { provide: PLANNER_MAP_DRIVER, useValue: factory };
}
