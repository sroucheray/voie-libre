import { RELIEF_PROBE } from '../app/core/map/map-layers';
import {
  MAP_FACTORY,
  MapCreateOptions,
  MapFactory,
  MapLike,
} from '../app/core/map/map-factory';

/** A MapLibre stand-in that records calls and lets tests fire events. */
export class FakeMap {
  center = { lng: 0, lat: 0 };
  zoom = 0;
  bearing = 0;
  removed = false;
  readonly calls: string[] = [];
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor(readonly options: MapCreateOptions) {
    this.center = { lng: options.center[0], lat: options.center[1] };
    this.zoom = options.zoom;
  }

  on(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    return this;
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
  getCenter() {
    return this.center;
  }
  getZoom() {
    return this.zoom;
  }
  getBearing() {
    return this.bearing;
  }
  jumpTo(options: { center?: [number, number]; zoom?: number }) {
    this.calls.push('jumpTo');
    if (options.center)
      this.center = { lng: options.center[0], lat: options.center[1] };
    if (options.zoom !== undefined) this.zoom = options.zoom;
  }
  zoomIn() {
    this.calls.push('zoomIn');
  }
  zoomOut() {
    this.calls.push('zoomOut');
  }
  resetNorth() {
    this.calls.push('resetNorth');
  }
  setStyle(style: unknown) {
    this.calls.push('setStyle');
    this.style = style;
    return this;
  }
  style: unknown;
  resize() {
    this.calls.push('resize');
  }
  remove() {
    this.removed = true;
  }
}

/**
 * Provides a factory that creates FakeMaps, kept in `maps` so tests can reach them. There is no
 * tiles server: the relief file exists only when `relief` says so.
 */
export function provideFakeMap(
  maps: FakeMap[] = [],
  { relief = false }: { relief?: boolean } = {},
) {
  const factory: MapFactory = async (options) => {
    const map = new FakeMap(options);
    maps.push(map);
    return map as unknown as MapLike;
  };
  return [
    { provide: MAP_FACTORY, useValue: factory },
    { provide: RELIEF_PROBE, useValue: async () => relief },
  ];
}
