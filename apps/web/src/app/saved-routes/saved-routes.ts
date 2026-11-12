import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  TranslocoPipe,
  TranslocoService,
  translateSignal,
} from '@jsverse/transloco';
import { FormattingService } from '../core/format/formatting.service';
import { autoRouteName, type AutoName } from '../planner/route-name';
import { FILE_DOWNLOADER } from '../export/file-download';
import { buildFit, fitFileName } from '../export/fit';
import {
  MAX_LAPS,
  clampLaps,
  isLoopRoute,
  lapTotals,
  repeatGeometry,
} from '../export/laps';
import { buildGpx, gpxFileName } from '@voie-libre/shared';
import {
  ElevationError,
  type ElevationErrorCode,
  ElevationService,
} from '../relief/elevation.service';
import {
  GpxImportError,
  type GpxImportErrorCode,
  parseGpx,
} from '../import/gpx-import';
import { PlannerStore, pointRole } from '../planner/planner-store';
import {
  ShareError,
  type ShareErrorCode,
  SHARING_ENABLED,
  ShareService,
} from '../sharing/share.service';
import {
  ROUTE_STORE,
  RouteStoreError,
  type RouteStoreErrorCode,
} from '../storage/route-store';
import type { SavedRoute } from '../storage/saved-route';

const GPX_IMPORT_CODES: readonly string[] = [
  'too_large',
  'invalid_file',
  'no_track',
  'too_short',
];

/** The browser refused the download. */
class ExportError extends Error {}

/**
 * Saving the planned route on the device and managing the saved ones: open, rename, delete
 * (after a confirmation). A storage failure shows a translated message and leaves the planner
 * fully usable.
 */
/** The file formats a saved route exports to. */
const EXPORT_FORMATS = ['gpx', 'fit'] as const;

/** The longest name a route can be given. */
export const NAME_MAX_LENGTH = 120;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

@Component({
  selector: 'vl-saved-routes',
  imports: [TranslocoPipe, NgTemplateOutlet],
  templateUrl: './saved-routes.html',
  styleUrl: './saved-routes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedRoutes {
  protected readonly format = inject(FormattingService);
  protected readonly planner = inject(PlannerStore);
  private readonly routeStore = inject(ROUTE_STORE);
  private readonly download = inject(FILE_DOWNLOADER);
  private readonly transloco = inject(TranslocoService);
  private readonly sharing = inject(ShareService);
  protected readonly sharingEnabled = inject(SHARING_ENABLED);
  private readonly relief = inject(ElevationService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * The form that names and saves the planned route. It sits here with the rest of the saving code,
   * but the planner shows it with the route being planned (`saveForm`, drawn by the planner), so it
   * is only drawn in this list when `formElsewhere` is off.
   */
  readonly formElsewhere = input(false);
  /** "Show in Saved" was pressed on the confirmation: the planner opens the list. */
  readonly showSaved = output<string>();
  readonly saveForm = viewChild.required<TemplateRef<unknown>>('saveForm');

  protected readonly routes = signal<SavedRoute[]>([]);
  protected readonly error = signal<
    | RouteStoreErrorCode
    | ShareErrorCode
    | GpxImportErrorCode
    | ElevationErrorCode
    | 'export_failed'
    | null
  >(null);
  /** The route whose share or unshare request is running. */
  protected readonly busyId = signal<string | null>(null);
  /** The route whose link was just copied. */
  protected readonly copiedId = signal<string | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  /** The route whose export formats are offered. */
  protected readonly exportingId = signal<string | null>(null);
  protected readonly exportFormats = EXPORT_FORMATS;
  /** The route whose opening waits for the user's yes, because a route is being planned. */
  protected readonly confirmingOpenId = signal<string | null>(null);
  protected readonly savable = this.planner.savable;
  /** Translation key of what the last import tells the user, or null. */
  protected readonly notice = signal<string | null>(null);
  /** The imported route (without elevation) the user is asked about: compute its climb? */
  protected readonly climbPromptId = signal<string | null>(null);

  /**
   * What the user typed in the name field; `null` while the proposed name applies. Once the user
   * has typed, the proposal no longer follows the route: nothing they change in it renames it.
   */
  private readonly draft = signal<string | null>(null);

  /** "Clermont-Ferrand → Issoire" when the places are known, else "Road, 41 km". */
  private readonly proposal = computed<AutoName>(() => {
    const route = this.savable();
    const named = route
      ? autoRouteName(route.points, (point) => this.planner.shortOf(point))
      : null;
    return (
      named ?? {
        key: `saved.defaultName.${route?.profile ?? 'road'}`,
        params: { distance: this.format.distance(route?.distanceMeters ?? 0) },
      }
    );
  });
  private readonly proposed = translateSignal(
    computed(() => this.proposal().key),
    computed(() => this.proposal().params),
  );
  /** The proposal, with the date added (then a number) when a saved route already has it. */
  private readonly defaultName = computed(() => {
    const name = this.proposed();
    const taken = new Set(this.routes().map((route) => route.name));
    if (!taken.has(name)) return name;
    const dated = `${name}, ${this.format.date(Date.now())}`;
    if (!taken.has(dated)) return dated;
    for (let n = 2; ; n++) {
      if (!taken.has(`${dated} (${n})`)) return `${dated} (${n})`;
    }
  });
  protected readonly name = computed(() => this.draft() ?? this.defaultName());

  constructor() {
    void this.refresh();
    // A route cleared is a new route: its name is proposed again, whatever was typed for the last.
    effect(() => {
      if (this.planner.points().length === 0) {
        untracked(() => this.draft.set(null));
      }
    });
    // "Show in Saved": the row that was lit comes into view (the list may be longer than the panel).
    effect(() => {
      if (!this.planner.highlightedId()) return;
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector('.fresh')
            ?.scrollIntoView({ block: 'nearest' }),
        { injector: this.injector },
      );
    });
    // A row can vanish under the pointer (delete, page change): no preview must stay behind.
    inject(DestroyRef).onDestroy(() => this.planner.preview.set(null));
  }

  protected readonly nameMax = NAME_MAX_LENGTH;

  /** A name is one line of text that wraps: a line break typed or pasted becomes a space. */
  protected onNameInput(event: Event): void {
    const field = event.target as HTMLTextAreaElement;
    const clean = field.value.replace(/\s*[\r\n]+\s*/g, ' ');
    if (clean !== field.value) field.value = clean;
    this.draft.set(clean);
    this.fit(field);
  }

  /** Enter saves (or renames): it never adds a line. True when the key was meant for the form. */
  protected onNameEnter(event: Event): boolean {
    if ((event as KeyboardEvent).isComposing) return false;
    event.preventDefault();
    return true;
  }

  /** Grows the field with its text where the browser cannot do it by itself (`field-sizing`). */
  protected fit(field: HTMLTextAreaElement): void {
    if (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))
      return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }

  protected showInList(id: string): void {
    this.showSaved.emit(id);
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
        elevationSource: route.elevationSource,
        ...(route.surfaces === undefined ? {} : { surfaces: route.surfaces }),
        ...(route.loop ? { loop: route.loop } : {}),
      });
      this.routes.update((routes) => [saved, ...routes]);
      this.planner.markSaved({ id: saved.id, name: saved.name });
      this.draft.set(null);
    });
  }

  /** Reads a GPX file on the device, saves it as a route and shows it. Nothing is sent anywhere. */
  protected async importGpx(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.notice.set(null);
    this.climbPromptId.set(null);
    await this.attempt(async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        throw new GpxImportError('invalid_file');
      }
      const imported = parseGpx(text, this.planner.profile());
      const name =
        imported.name || file.name.replace(/\.gpx$/i, '').trim() || 'GPX';
      const saved = await this.routeStore.save({
        name,
        profile: this.planner.profile(),
        points: imported.points,
        geometry: imported.geometry,
        distanceMeters: imported.distanceMeters,
        ascentMeters: imported.ascentMeters,
        durationSeconds: imported.durationSeconds,
      });
      this.routes.update((routes) => [saved, ...routes]);
      this.planner.loadSaved(saved);
      this.planner.markSaved({ id: saved.id, name: saved.name });
      this.climbPromptId.set(imported.ascentMeters === null ? saved.id : null);
      this.notice.set(
        imported.ascentMeters === null
          ? 'gpxImport.noElevation'
          : imported.thinned
            ? 'gpxImport.thinned'
            : null,
      );
    });
  }

  /**
   * Asks the API for the terrain elevations of an imported route and stores them with the climb.
   * `show` reloads the route in the planner (it is the one just imported).
   */
  protected async computeClimb(id: string, show = false): Promise<void> {
    await this.withRoute(id, async (route) => {
      const { geometry, ascentMeters } = await this.relief.forGeometry(
        route.geometry,
      );
      const updated = await this.routeStore.setElevation(
        id,
        geometry,
        ascentMeters,
        'copernicus',
      );
      this.replace(updated);
      if (show) {
        this.planner.loadSaved(updated);
        this.planner.markSaved({ id: updated.id, name: updated.name });
      }
      this.climbPromptId.set(null);
      this.notice.set(null);
    });
  }

  protected keepClimbUnknown(): void {
    this.climbPromptId.set(null);
  }

  /** Shows a route on the map while the pointer or the focus is on its row. */
  protected preview(geometry: SavedRoute['geometry'] | null): void {
    this.planner.preview.set(geometry);
  }

  /** Opens at once when nothing is planned, else asks before replacing the route on screen. */
  protected requestOpen(id: string): void {
    // Only work that is not on the device is worth a question: an opened route left alone, or a
    // route just saved, is replaced at once.
    if (!this.planner.unsaved()) {
      void this.open(id);
      return;
    }
    this.confirmingOpenId.set(id);
  }

  protected cancelOpen(): void {
    this.confirmingOpenId.set(null);
  }

  protected async confirmOpen(id: string): Promise<void> {
    this.confirmingOpenId.set(null);
    await this.open(id);
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
      this.planner.markSaved({ id: saved.id, name: saved.name });
    });
  }

  /** Shows or hides the choice of a file format under a route. */
  protected toggleExport(id: string): void {
    this.exportingId.update((current) => (current === id ? null : id));
  }

  /** Builds the file on the device from the stored geometry and downloads it. */
  protected async exportAs(id: string, format: ExportFormat): Promise<void> {
    this.exportingId.set(null);
    await this.attempt(async () => {
      const saved = await this.routeStore.get(id);
      if (!saved) {
        this.routes.update((routes) => routes.filter((r) => r.id !== id));
        throw new RouteStoreError('not_found');
      }
      try {
        const names = this.pointNames(saved);
        const laps = this.lapsOf(saved);
        if (format === 'fit') {
          this.download(
            buildFit(saved, names.slice(1, -1), laps),
            fitFileName(saved.name),
            'application/vnd.ant.fit',
          );
        } else {
          this.download(
            buildGpx(
              {
                ...saved,
                geometry: repeatGeometry(saved.geometry, laps),
                withElevation: saved.ascentMeters !== null,
              },
              names,
            ),
            gpxFileName(saved.name),
            'application/gpx+xml',
          );
        }
      } catch {
        throw new ExportError();
      }
    });
  }

  protected readonly maxLaps = MAX_LAPS;

  /** Only a route whose end is on its start can be done several times in a row. */
  protected isLoop(route: SavedRoute): boolean {
    return isLoopRoute(route.points);
  }

  /** How many laps an export of the route holds: 1 unless it is a loop with a number of laps. */
  protected lapsOf(route: SavedRoute): number {
    return this.isLoop(route) ? clampLaps(route.laps) : 1;
  }

  /** What all the laps add up to (the figures of the route when there is one lap). */
  protected lapsTotal(route: SavedRoute) {
    return lapTotals(route, this.lapsOf(route));
  }

  /** "3 laps: 45 km, 1 200 m climb", or without the climb when it is unknown. */
  protected lapsTotalKey(route: SavedRoute): string {
    return route.ascentMeters === null
      ? 'saved.laps.totalNoClimb'
      : 'saved.laps.total';
  }

  protected lapsTotalParams(route: SavedRoute) {
    const total = this.lapsTotal(route);
    return {
      n: this.lapsOf(route),
      distance: this.format.distance(total.distanceMeters),
      ascent:
        total.ascentMeters === null
          ? ''
          : this.format.elevation(total.ascentMeters),
    };
  }

  /** The number of laps was changed in the export panel: kept with the route. */
  protected async setLaps(id: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const laps = clampLaps(input.value);
    input.value = String(laps);
    await this.withRoute(id, async () => {
      this.replace(await this.routeStore.setLaps(id, laps));
    });
  }

  /** Translation key of an error: sharing failures have their own messages. */
  protected errorKey(code: string): string {
    if (code.startsWith('elevation_')) {
      return `relief.errors.${code.slice('elevation_'.length)}`;
    }
    if (GPX_IMPORT_CODES.includes(code)) return `gpxImport.errors.${code}`;
    const sharing: readonly string[] = [
      'network',
      'rate_limited',
      'payload_too_large',
      'already_exists',
      'invalid_request',
      'forbidden',
    ];
    return sharing.includes(code)
      ? `sharing.errors.${code}`
      : `saved.errors.${code}`;
  }

  /** Deleting a shared route also stops sharing it: the confirmation says so. */
  protected confirmDeleteKey(route: SavedRoute): string {
    return route.share ? 'sharing.confirmDeleteShared' : 'saved.confirmDelete';
  }

  protected linkFor(id: string): string {
    return this.sharing.linkFor(id);
  }

  /** Sends the route to the server on request, and keeps the delete token on the device. */
  protected async share(id: string): Promise<void> {
    await this.withRoute(id, async (route) => {
      const info = await this.sharing.share(route);
      this.replace(await this.routeStore.setShare(id, info));
    });
  }

  protected async stopSharing(id: string): Promise<void> {
    await this.withRoute(id, async (route) => {
      await this.sharing.unshare(route);
      this.replace(await this.routeStore.setShare(id, null));
    });
  }

  protected async copyLink(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.linkFor(id));
      this.copiedId.set(id);
    } catch {
      // No clipboard access (insecure page, denied): the link stays selectable in its field.
      this.copiedId.set(null);
    }
  }

  protected selectLink(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  /** Runs a request on one route, disabling its buttons meanwhile. */
  private async withRoute(
    id: string,
    operation: (route: SavedRoute) => Promise<void>,
  ): Promise<void> {
    await this.attempt(async () => {
      const route = this.routes().find((r) => r.id === id);
      if (!route) throw new RouteStoreError('not_found');
      this.busyId.set(id);
      try {
        await operation(route);
      } finally {
        this.busyId.set(null);
      }
    });
  }

  private replace(updated: SavedRoute): void {
    this.routes.update((routes) =>
      routes.map((r) => (r.id === updated.id ? updated : r)),
    );
  }

  /** "Start", "Waypoint 1", "End" in the active language: the names of the GPX waypoints. */
  private pointNames(saved: SavedRoute): string[] {
    return saved.points.map((_, index) =>
      this.transloco.translate(
        `planner.points.${pointRole(index, saved.points.length)}`,
        { n: index },
      ),
    );
  }

  protected startRename(id: string): void {
    this.confirmingId.set(null);
    this.renamingId.set(id);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLTextAreaElement>('.rename-input')
          ?.select(),
      { injector: this.injector },
    );
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  protected async rename(id: string, value: string): Promise<void> {
    const name = value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (!name) return;
    await this.attempt(async () => {
      const renamed = await this.routeStore.rename(id, name);
      this.routes.update((routes) =>
        routes.map((r) => (r.id === id ? renamed : r)),
      );
      this.planner.renameSaved(id, renamed.name);
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
      const route = this.routes().find((r) => r.id === id);
      this.busyId.set(id);
      try {
        // A shared route is unshared first: once deleted here, its token would be lost and the
        // public copy could never be removed. If the server cannot be reached, nothing is deleted.
        if (route?.share) await this.sharing.unshare(route);
        await this.routeStore.delete(id);
        this.planner.preview.set(null);
        this.planner.forgetSaved(id);
        this.routes.update((routes) => routes.filter((r) => r.id !== id));
        this.confirmingId.set(null);
      } finally {
        this.busyId.set(null);
      }
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
      this.error.set(
        error instanceof ExportError
          ? 'export_failed'
          : error instanceof RouteStoreError || error instanceof ShareError
            ? error.code
            : error instanceof GpxImportError || error instanceof ElevationError
              ? error.code
              : 'unknown',
      );
    }
  }
}
