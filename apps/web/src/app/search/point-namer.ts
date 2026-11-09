import { Injectable, effect, inject, untracked } from '@angular/core';
import type { LngLat } from '../core/map/map-factory';
import { NetworkStatus } from '../core/offline/network-status';
import { PlannerStore } from '../planner/planner-store';
import { GeocodingService } from './geocoding.service';

/** Wait for a dragged or quickly changed point to settle before asking for its address. */
export const NAME_DEBOUNCE_MS = 400;

const keyOf = (point: LngLat) => `${point[0]},${point[1]}`;

/**
 * Finds the address of the start and the end when they were placed another way than by search
 * (a click, the menu, a drag, "My position"), so that the fields can show it. Only these two
 * points are looked up. Nothing is asked offline or for a route that was opened (saved, imported
 * or shared: opening one never calls the API), and a failure leaves the coordinates.
 */
@Injectable({ providedIn: 'root' })
export class PointNamer {
  private readonly store = inject(PlannerStore);
  private readonly geocoding = inject(GeocodingService);
  private readonly network = inject(NetworkStatus);
  /** Positions already asked for, so that none is asked twice. */
  private readonly asked = new Set<string>();

  constructor() {
    effect((onCleanup) => {
      const points = this.store.points();
      const labels = this.store.labels();
      // A point being dragged has no place yet: its address is asked once it is dropped.
      if (this.store.dragging()) return;
      if (!this.network.online() || points.length === 0) return;
      const ends = [points[0], points[points.length - 1]];
      const missing = ends.filter(
        (point, i) =>
          ends.findIndex((other) => keyOf(other) === keyOf(point)) === i &&
          !labels[keyOf(point)] &&
          this.store.lookupWanted(point) &&
          !this.asked.has(keyOf(point)),
      );
      if (missing.length === 0) return;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        for (const point of missing) void this.name(point, controller.signal);
      }, NAME_DEBOUNCE_MS);
      onCleanup(() => {
        clearTimeout(timer);
        controller.abort();
      });
    });
  }

  private async name(point: LngLat, signal: AbortSignal): Promise<void> {
    const key = keyOf(point);
    this.asked.add(key);
    const label = await this.geocoding.reverse(point, signal);
    if (label) untracked(() => this.store.setLabel(point, label));
    // A failure (or an abort) lets the next change of the points try again.
    else this.asked.delete(key);
  }
}
