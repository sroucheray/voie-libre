import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { FormattingService } from '../core/format/formatting.service';
import { PlannerStore } from '../planner/planner-store';
import {
  ROUTE_STORE,
  RouteStoreError,
  type RouteStoreErrorCode,
} from '../storage/route-store';
import {
  ShareError,
  type ShareErrorCode,
  type SharedRoute,
  ShareService,
} from './share.service';

/**
 * A route opened from a shared link (`/p/:id`): it is read from the API once, then shown on the
 * map like a saved route, without being computed. Nothing is stored unless the user keeps it.
 */
@Component({
  selector: 'vl-shared-route-page',
  imports: [TranslocoPipe, RouterLink],
  templateUrl: './shared-route-page.html',
  styleUrl: './shared-route-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedRoutePage {
  protected readonly format = inject(FormattingService);
  private readonly planner = inject(PlannerStore);
  private readonly share = inject(ShareService);
  private readonly routeStore = inject(ROUTE_STORE);

  protected readonly route = signal<SharedRoute | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<
    ShareErrorCode | RouteStoreErrorCode | null
  >(null);
  protected readonly kept = signal(false);

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
    this.kept.set(false);
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

  /** Saves a copy on the device, under a new id: it is not shared from here. */
  protected async keep(): Promise<void> {
    const route = this.route();
    if (!route) return;
    try {
      await this.routeStore.save({
        name: route.name,
        profile: route.profile,
        points: route.points,
        geometry: route.geometry,
        distanceMeters: route.distanceMeters,
        ascentMeters: route.ascentMeters,
        durationSeconds: route.durationSeconds,
      });
      this.error.set(null);
      this.kept.set(true);
    } catch (error) {
      this.error.set(error instanceof RouteStoreError ? error.code : 'unknown');
    }
  }
}
