import { Injectable, signal } from '@angular/core';
import type { Box } from '../offline/area-tiles';

/**
 * What the map shows right now, as a box: kept by `MapView`, read by whoever needs the view (the
 * offline panel keeps "this view"). `null` until the map exists.
 */
@Injectable({ providedIn: 'root' })
export class MapViewport {
  readonly box = signal<Box | null>(null);
}
