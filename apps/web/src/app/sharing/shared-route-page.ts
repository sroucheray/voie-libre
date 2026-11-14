import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { OpenedRouteDialog, type OpenedRoute } from './opened-route-dialog';
import {
  ShareError,
  type ShareErrorCode,
  type SharedRoute,
  ShareService,
} from './share.service';

/**
 * A short link opened (`/p/:id`): the route is read from the API once, shown on the map like a
 * saved route without being computed, and a dialog asks what to do with it: save it, just look at
 * it, or export it. Nothing is stored unless the person saves it.
 */
@Component({
  selector: 'vl-shared-route-page',
  imports: [TranslocoPipe, RouterLink, OpenedRouteDialog],
  templateUrl: './shared-route-page.html',
  styleUrl: './shared-route-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedRoutePage {
  private readonly planner = inject(PlannerStore);
  private readonly share = inject(ShareService);
  private readonly router = inject(Router);

  protected readonly route = signal<SharedRoute | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ShareErrorCode | null>(null);
  /** The route as the dialog saves and exports it: the whole itinerary is already there. */
  protected readonly openedRoute = computed<OpenedRoute | null>(() => {
    const route = this.route();
    if (!route) return null;
    return {
      profile: route.profile,
      points: route.points,
      geometry: route.geometry,
      distanceMeters: route.distanceMeters,
      ascentMeters: route.ascentMeters,
      durationSeconds: route.durationSeconds,
    };
  });

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id'))),
    { initialValue: null },
  );

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.route.set(null);
    try {
      const route = await this.share.fetch(id);
      this.route.set(route);
      this.planner.loadSaved(route);
    } catch (error) {
      this.error.set(error instanceof ShareError ? error.code : 'unknown');
    } finally {
      this.loading.set(false);
    }
  }

  /** The dialog is answered: back to the planner, replacing the entry that holds the link. */
  protected done(): void {
    this.route.set(null);
    void this.router.navigate(['/'], { replaceUrl: true });
  }
}
