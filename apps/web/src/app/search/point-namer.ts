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
  /** Requests running, by position: one is cancelled only when its place is no longer an end. */
  private readonly inFlight = new Map<string, AbortController>();

  constructor() {
    effect((onCleanup) => {
      const points = this.store.points();
      const labels = this.store.labels();
      // A point being dragged has no place yet: its address is asked once it is dropped.
      if (this.store.dragging()) return;
      if (!this.network.online() || points.length === 0) return;
      const ends = [points[0], points[points.length - 1]];
      // A place that is no longer an end (moved, removed) is not worth an answer any more. One
      // that still is keeps its request: the answer for the other end must not cancel it.
      const wanted = new Set(ends.map(keyOf));
      for (const [key, controller] of this.inFlight) {
        if (!wanted.has(key)) {
          controller.abort();
          this.inFlight.delete(key);
        }
      }
      const missing = ends.filter(
        (point, i) =>
          ends.findIndex((other) => keyOf(other) === keyOf(point)) === i &&
          !labels[keyOf(point)] &&
          this.store.lookupWanted(point) &&
          !this.asked.has(keyOf(point)) &&
          !this.inFlight.has(keyOf(point)),
      );
      if (missing.length === 0) return;
      const timer = setTimeout(() => {
        for (const point of missing) {
          const controller = new AbortController();
          this.inFlight.set(keyOf(point), controller);
          void this.name(point, controller);
        }
      }, NAME_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private async name(
    point: LngLat,
    controller: AbortController,
  ): Promise<void> {
    const key = keyOf(point);
    this.asked.add(key);
    const place = await this.geocoding.reverse(point, controller.signal);
    if (this.inFlight.get(key) === controller) this.inFlight.delete(key);
    if (place) {
      untracked(() => this.store.setLabel(point, place.label, place.short));
    }
    // A failure (or an abort) lets the next change of the points try again.
    else this.asked.delete(key);
  }
}
