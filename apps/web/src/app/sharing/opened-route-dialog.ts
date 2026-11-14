import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FormattingService } from '../core/format/formatting.service';
import { Analytics } from '../core/analytics/analytics';
import { FILE_DOWNLOADER } from '../export/file-download';
import {
  EXPORT_FORMATS,
  buildExportFile,
  type ExportFormat,
} from '../export/route-export';
import { pointRole, PlannerStore } from '../planner/planner-store';
import { ROUTE_STORE, RouteStoreError } from '../storage/route-store';
import type { NewSavedRoute } from '../storage/saved-route';
import { ShareDialogService } from './share-dialog.service';

/** A route opened from a link, as far as it is known: what saving or exporting it needs. */
export type OpenedRoute = Omit<NewSavedRoute, 'name'>;

/**
 * What to do with a route that was just opened from a link: save it to the saved routes, simply
 * look at it on the map, or export it as a GPX or FIT file at once. Saving and exporting wait for
 * the route to be calculated when the link carried only its points.
 */
@Component({
  selector: 'vl-opened-route-dialog',
  imports: [TranslocoPipe],
  templateUrl: './opened-route-dialog.html',
  styleUrl: './opened-route-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenedRouteDialog {
  /** The name given by the link, if it has one. */
  readonly name = input<string | null>(null);
  /** The route once it is known; `null` while it is being calculated. */
  readonly route = input.required<OpenedRoute | null>();
  /** The calculation failed: nothing can be saved or exported, the route can still be looked at. */
  readonly failed = input(false);
  /** The person is done: the planner is shown. */
  readonly closed = output<void>();

  private readonly routeStore = inject(ROUTE_STORE);
  private readonly planner = inject(PlannerStore);
  private readonly download = inject(FILE_DOWNLOADER);
  private readonly analytics = inject(Analytics);
  private readonly transloco = inject(TranslocoService);
  private readonly dialogs = inject(ShareDialogService);
  private readonly format = inject(FormattingService);

  protected readonly formats = EXPORT_FORMATS;
  protected readonly busy = signal(false);
  protected readonly notice = signal<'exported' | null>(null);
  protected readonly error = signal<string | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog || dialog.open) return;
      // jsdom has no showModal: the dialog still opens, only without its backdrop.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  /** The name the route is saved or exported under: the link's, else "Road, 41 km". */
  private routeName(route: OpenedRoute): string {
    const given = this.name()?.trim();
    if (given) return given;
    return this.transloco.translate(`saved.defaultName.${route.profile}`, {
      distance: this.format.distance(route.distanceMeters),
    });
  }

  protected async save(): Promise<void> {
    const route = this.route();
    if (!route || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.routeStore.save({
        ...route,
        name: this.routeName(route),
      });
      this.planner.markSaved({ id: saved.id, name: saved.name });
      this.dialogs.notifyChanged();
      this.closed.emit();
    } catch (error) {
      this.error.set(
        `saved.errors.${error instanceof RouteStoreError ? error.code : 'unknown'}`,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected show(): void {
    this.closed.emit();
  }

  protected exportAs(format: ExportFormat): void {
    const route = this.route();
    if (!route) return;
    this.error.set(null);
    this.notice.set(null);
    try {
      const points = route.points;
      const names = points.map((_, index) =>
        this.transloco.translate(
          `planner.points.${pointRole(index, points.length)}`,
          { n: index },
        ),
      );
      const file = buildExportFile(
        { ...route, name: this.routeName(route), createdAt: Date.now() },
        format,
        names,
      );
      this.download(file.content, file.fileName, file.mimeType);
      this.notice.set('exported');
      this.analytics.report({ event: `export_${format}` });
    } catch {
      this.error.set('saved.errors.export_failed');
    }
  }

  protected onCancel(event: Event): void {
    // Escape is "just show it".
    event.preventDefault();
    this.show();
  }
}
