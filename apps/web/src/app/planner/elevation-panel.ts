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
  buildProfile,
  sampleAtDistance,
  type ProfileSample,
} from './elevation-profile';
import { PlannerStore } from './planner-store';

const WIDTH = 1000;
const HEIGHT = 100;
/** Share of the keyboard range moved by one arrow key press. */
const KEY_STEPS = 100;

/**
 * Elevation along the selected route, under the map. Hovering (or arrow keys) moves a cursor that
 * the map follows with a dot; hovering the route on the map moves the cursor back.
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
  protected readonly open = signal(true);

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
    const line = `M${points.join('L')}`;
    return { line, area: `${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z` };
  });

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

  protected grade(sample: ProfileSample): string {
    const value = this.format.number(sample.grade, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${value} %`;
  }

  protected onPointerMove(event: PointerEvent): void {
    const profile = this.profile();
    if (!profile) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - box.left) / box.width),
    );
    this.store.cursor.set(
      sampleAtDistance(profile, ratio * profile.totalDistance).index,
    );
  }

  protected onPointerLeave(): void {
    this.store.cursor.set(null);
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
    else if (event.key === 'Escape') this.store.cursor.set(null);
    if (next !== null) {
      event.preventDefault();
      this.store.cursor.set(next);
    }
  }
}
