import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormattingService } from '../core/format/formatting.service';
import {
  GRADE_BANDS,
  buildProfile,
  gradeRuns,
  sampleAtDistance,
  stretchStats,
  type ElevationProfile,
  type ProfileSample,
} from './elevation-profile';
import { PlannerStore } from './planner-store';
import {
  SURFACE_COLORS,
  surfaceKey,
  surfaceRuns,
  surfaceShares,
} from './route-surface';

const WIDTH = 1000;
const HEIGHT = 100;
/** Share of the keyboard range moved by one arrow key press. */
const KEY_STEPS = 100;

/**
 * Elevation along the selected route, under the map, coloured by how steep it is. Hovering (or
 * arrow keys) moves a cursor that the map follows with a dot; hovering the route on the map moves
 * the cursor back. Dragging over the chart picks a stretch: its totals show under the chart and
 * the map highlights it; a click or Escape lets it go.
 */
@Component({
  selector: 'vl-elevation-panel',
  imports: [TranslocoPipe],
  templateUrl: './elevation-panel.html',
  styleUrl: './elevation-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElevationPanel {
  protected readonly store = inject(PlannerStore);
  protected readonly format = inject(FormattingService);
  /** Open by default, except on a phone where the map needs the room: there it starts closed. */
  protected readonly open = signal(
    !(
      typeof matchMedia === 'function' &&
      matchMedia('(max-width: 40rem)').matches
    ),
  );

  protected readonly profile = computed(() =>
    buildProfile(this.store.selectedGeometry()),
  );

  /** The line and the filled area, in a `WIDTH` by `HEIGHT` box stretched to the panel. */
  protected readonly paths = computed(() => {
    const profile = this.profile();
    if (!profile) return null;
    const span = Math.max(profile.maxElevation - profile.minElevation, 1);
    const points = profile.samples.map((sample) => {
      const x = (sample.distance / profile.totalDistance) * WIDTH;
      const y =
        HEIGHT - ((sample.elevation - profile.minElevation) / span) * HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    // One filled shape per run of the same grade band, down to the bottom of the chart.
    const areas = gradeRuns(profile).map((run) => {
      const first = points[run.from].split(',')[0];
      const last = points[run.to].split(',')[0];
      const top = points.slice(run.from, run.to + 1).join('L');
      return {
        band: run.band,
        d: `M${first},${HEIGHT}L${top}L${last},${HEIGHT}Z`,
      };
    });
    return { line: `M${points.join('L')}`, areas };
  });

  /**
   * What the route rides on: runs along the chart's distance, and the share of each category.
   * `null` for a route that does not say (imported, saved before it was told).
   */
  protected readonly surface = computed(() => {
    const profile = this.profile();
    const surfaces = this.store.selectedSurfaces();
    if (!profile || surfaces === null) return null;
    const shares = surfaceShares(profile, surfaces);
    if (shares.length === 0) return null;
    const runs = surfaceRuns(surfaces).map((run) => ({
      code: run.code,
      color: SURFACE_COLORS[run.code],
      left: (profile.samples[run.from].distance / profile.totalDistance) * 100,
      width:
        ((profile.samples[run.to].distance -
          profile.samples[run.from].distance) /
          profile.totalDistance) *
        100,
    }));
    return {
      runs,
      shares: shares.map((share) => ({
        ...share,
        color: SURFACE_COLORS[share.code],
        key: surfaceKey(share.code),
      })),
    };
  });

  /** The grade bands, for the legend: "3–6 %", then "15 % +" for the last one. */
  protected readonly legend = GRADE_BANDS.map((from, band) => ({
    band,
    from,
    to: GRADE_BANDS[band + 1] ?? null,
  }));

  /** The stretch picked by dragging: where it sits on the chart and what it adds up to. */
  protected readonly stretch = computed(() => {
    const profile = this.profile();
    const stretch = this.store.stretch();
    if (!profile || !stretch) return null;
    const from = profile.samples[stretch.from];
    const to = profile.samples[stretch.to];
    if (!from || !to) return null;
    return {
      left: (from.distance / profile.totalDistance) * 100,
      width: ((to.distance - from.distance) / profile.totalDistance) * 100,
      stats: stretchStats(profile, stretch.from, stretch.to),
    };
  });

  /** Where the pointer went down, while it is down. */
  private anchor: number | null = null;
  /** Where a selection made with Shift and the arrow keys started. */
  private keyAnchor: number | null = null;
  /** Whether the pointer moved to another point since it went down. */
  private dragged = false;

  protected readonly cursor = computed<ProfileSample | null>(() => {
    const profile = this.profile();
    const index = this.store.cursor();
    return profile && index !== null ? (profile.samples[index] ?? null) : null;
  });

  protected readonly cursorLeft = computed(() => {
    const profile = this.profile();
    const cursor = this.cursor();
    return profile && cursor
      ? (cursor.distance / profile.totalDistance) * 100
      : 0;
  });

  protected readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;

  protected grade(sample: { grade: number }): string {
    const value = this.format.number(sample.grade, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${value} %`;
  }

  /** A share of the route, to the whole percent. */
  protected shareOf(fraction: number): string {
    return `${this.format.number(fraction * 100, { maximumFractionDigits: 0 })} %`;
  }

  protected percent(value: number): string {
    return `${this.format.number(value)} %`;
  }

  protected onPointerDown(event: PointerEvent): void {
    const profile = this.profile();
    if (!profile || event.button !== 0) return;
    const index = this.indexAt(profile, event);
    if (index === null) return;
    this.anchor = index;
    this.dragged = false;
    // The drag goes on when the pointer leaves the chart.
    const plot = event.currentTarget as HTMLElement;
    try {
      plot.setPointerCapture?.(event.pointerId);
    } catch {
      // No such pointer (a synthetic event): the drag still works inside the chart.
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    const profile = this.profile();
    if (!profile) return;
    const index = this.indexAt(profile, event);
    if (index === null) return;
    this.store.cursor.set(index);
    if (this.anchor !== null && (this.dragged || index !== this.anchor)) {
      this.dragged = true;
      this.store.selectStretch([this.anchor, index]);
    }
  }

  protected onPointerUp(): void {
    // A press that did not move is a click: it lets the stretch go.
    if (this.anchor !== null && !this.dragged) this.store.selectStretch(null);
    this.anchor = null;
  }

  protected onPointerCancel(): void {
    this.anchor = null;
  }

  protected onPointerLeave(): void {
    this.store.cursor.set(null);
  }

  private indexAt(
    profile: ElevationProfile,
    event: PointerEvent,
  ): number | null {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width === 0) return null;
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - box.left) / box.width),
    );
    return sampleAtDistance(profile, ratio * profile.totalDistance).index;
  }

  protected onKeydown(event: KeyboardEvent): void {
    const profile = this.profile();
    if (!profile) return;
    const last = profile.samples.length - 1;
    const step = Math.max(1, Math.round(last / KEY_STEPS));
    const current = this.store.cursor();
    let next: number | null = null;
    if (event.key === 'ArrowRight')
      next = Math.min(last, (current ?? -step) + step);
    else if (event.key === 'ArrowLeft')
      next = Math.max(0, (current ?? step) - step);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape') {
      this.store.cursor.set(null);
      this.store.selectStretch(null);
      this.anchor = null;
      this.keyAnchor = null;
    }
    if (next !== null) {
      event.preventDefault();
      // With Shift, the keys stretch a selection from where the cursor was.
      if (!event.shiftKey) this.keyAnchor = null;
      else this.keyAnchor ??= current ?? next;
      this.store.cursor.set(next);
      if (this.keyAnchor !== null) {
        this.store.selectStretch([this.keyAnchor, next]);
      }
    }
  }
}
