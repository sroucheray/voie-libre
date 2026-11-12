import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** After this many seconds the badge says that long routes take a while, and counts them. */
export const COMPUTING_LONG_AFTER_SECONDS = 8;

/**
 * A badge over the map while a route is being computed: a spinner and a line, so that the wait is
 * seen (and heard, as a status) even with the planner's sheet closed. For a long computation it
 * counts the seconds and says it can take a minute. The planner decides when it shows (`active`).
 */
@Component({
  selector: 'vl-compute-badge',
  imports: [TranslocoPipe],
  templateUrl: './compute-badge.html',
  styleUrl: './compute-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComputeBadge {
  readonly active = input.required<boolean>();
  protected readonly seconds = signal(0);
  protected readonly long = computed(
    () => this.seconds() >= COMPUTING_LONG_AFTER_SECONDS,
  );

  constructor() {
    effect((onCleanup) => {
      if (!this.active()) {
        untracked(() => this.seconds.set(0));
        return;
      }
      const start = Date.now();
      const timer = setInterval(
        () => this.seconds.set(Math.floor((Date.now() - start) / 1000)),
        1000,
      );
      onCleanup(() => clearInterval(timer));
    });
  }
}
