import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import { FormattingService } from '../core/format/formatting.service';
import { PlannerStore } from '../planner/planner-store';
import {
  ROUTE_STORE,
  RouteStoreError,
  type RouteStoreErrorCode,
} from '../storage/route-store';
import type { SavedRoute } from '../storage/saved-route';

/**
 * Saving the planned route on the device and managing the saved ones: open, rename, delete
 * (after a confirmation). A storage failure shows a translated message and leaves the planner
 * fully usable.
 */
@Component({
  selector: 'vl-saved-routes',
  imports: [TranslocoPipe],
  templateUrl: './saved-routes.html',
  styleUrl: './saved-routes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedRoutes {
  protected readonly format = inject(FormattingService);
  private readonly planner = inject(PlannerStore);
  private readonly routeStore = inject(ROUTE_STORE);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly routes = signal<SavedRoute[]>([]);
  protected readonly error = signal<RouteStoreErrorCode | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly savable = this.planner.savable;

  /** What the user typed in the name field; `null` while the proposed name applies. */
  private readonly draft = signal<string | null>(null);

  /** "Road, 41 km": proposed until the user types another name. */
  private readonly defaultName = translateSignal(
    computed(() => `saved.defaultName.${this.savable()?.profile ?? 'road'}`),
    computed(() => ({
      distance: this.format.distance(this.savable()?.distanceMeters ?? 0),
    })),
  );
  protected readonly name = computed(() => this.draft() ?? this.defaultName());

  constructor() {
    void this.refresh();
  }

  protected onNameInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected async save(): Promise<void> {
    const route = this.savable();
    if (!route) return;
    const name = this.name().trim() || this.defaultName();
    await this.attempt(async () => {
      const saved = await this.routeStore.save({
        name,
        profile: route.profile,
        points: route.points,
        geometry: route.geometry,
        distanceMeters: route.distanceMeters,
        ascentMeters: route.ascentMeters,
        durationSeconds: route.durationSeconds,
      });
      this.routes.update((routes) => [saved, ...routes]);
      this.draft.set(null);
    });
  }

  protected async open(id: string): Promise<void> {
    await this.attempt(async () => {
      const saved = await this.routeStore.get(id);
      if (!saved) {
        // Deleted elsewhere (another tab): say so and drop it from the list.
        this.routes.update((routes) => routes.filter((r) => r.id !== id));
        throw new RouteStoreError('not_found');
      }
      this.planner.loadSaved(saved);
    });
  }

  protected startRename(id: string): void {
    this.confirmingId.set(null);
    this.renamingId.set(id);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLInputElement>('.rename-input')
          ?.select(),
      { injector: this.injector },
    );
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  protected async rename(id: string, value: string): Promise<void> {
    const name = value.trim();
    if (!name) return;
    await this.attempt(async () => {
      const renamed = await this.routeStore.rename(id, name);
      this.routes.update((routes) =>
        routes.map((r) => (r.id === id ? renamed : r)),
      );
      this.renamingId.set(null);
    });
  }

  protected askDelete(id: string): void {
    this.renamingId.set(null);
    this.confirmingId.set(id);
  }

  protected cancelDelete(): void {
    this.confirmingId.set(null);
  }

  protected async confirmDelete(id: string): Promise<void> {
    await this.attempt(async () => {
      await this.routeStore.delete(id);
      this.routes.update((routes) => routes.filter((r) => r.id !== id));
      this.confirmingId.set(null);
    });
  }

  private async refresh(): Promise<void> {
    await this.attempt(async () => {
      this.routes.set(await this.routeStore.list());
    });
  }

  /** Runs a storage operation; a failure becomes a translated message, never an exception. */
  private async attempt(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
      this.error.set(null);
    } catch (error) {
      this.error.set(error instanceof RouteStoreError ? error.code : 'unknown');
    }
  }
}
