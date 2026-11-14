import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { PlannerStore } from '../planner/planner-store';
import {
  decodeRouteLink,
  type RouteLink,
  type RouteLinkErrorCode,
} from './route-link';

/**
 * A route opened from a link (`/r#v=1&…`): the fragment is read on the device, never sent
 * anywhere, and the points go into the planner, which computes the route like any itinerary.
 * Unsaved work on screen is not replaced without asking. The address goes back to `/` at once,
 * so the link does not stay in the history.
 */
@Component({
  selector: 'vl-route-link-page',
  imports: [TranslocoPipe, RouterLink],
  templateUrl: './route-link-page.html',
  styleUrl: './route-link-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteLinkPage {
  private readonly planner = inject(PlannerStore);
  private readonly router = inject(Router);

  protected readonly error = signal<RouteLinkErrorCode | null>(null);
  /** A route is waiting for the answer to "replace what is on screen?". */
  protected readonly pending = signal<RouteLink | null>(null);

  private readonly fragment = toSignal(
    inject(ActivatedRoute).fragment.pipe(map((fragment) => fragment ?? '')),
    { initialValue: null },
  );

  constructor() {
    effect(() => {
      const fragment = this.fragment();
      if (fragment !== null) untracked(() => this.read(fragment));
    });
  }

  private read(fragment: string): void {
    this.error.set(null);
    this.pending.set(null);
    const result = decodeRouteLink(fragment);
    if (!result.ok) {
      this.error.set(result.code);
      return;
    }
    if (this.planner.unsaved()) {
      this.pending.set(result.link);
      return;
    }
    this.open(result.link);
  }

  protected replace(): void {
    const link = this.pending();
    if (link) this.open(link);
  }

  protected keepMine(): void {
    this.pending.set(null);
    void this.leave();
  }

  private open(link: RouteLink): void {
    this.planner.openLink(link);
    void this.leave();
  }

  /** Back to the planner, replacing the entry that holds the link. */
  private leave(): Promise<boolean> {
    return this.router.navigate(['/'], { replaceUrl: true });
  }
}
