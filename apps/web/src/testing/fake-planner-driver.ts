import {
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
  destroyed = false;

  constructor(readonly handlers: PlannerMapHandlers) {}

  setMarkers(markers: MarkerSpec[]) {
    this.markers = markers;
  }
  setRoutes(routes: LngLat3[][], selected: number) {
    this.routes = routes;
    this.selected = selected;
  }
  fitRoute(geometry: LngLat3[]) {
    this.fitted.push(geometry);
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
