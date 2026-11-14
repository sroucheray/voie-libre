import { SHARE_SHEET } from '../sharing/share-sheet';
import { ShareDialogService } from '../sharing/share-dialog.service';
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
import { Modal } from '../core/modal/modal';
import { autoRouteName, type AutoName } from '../planner/route-name';
import { Analytics } from '../core/analytics/analytics';
import { FILE_DOWNLOADER } from '../export/file-download';
import {
  EXPORT_FORMATS,
  buildExportFile,
  type ExportFormat,
} from '../export/route-export';
import { MAX_LAPS, clampLaps, isLoopRoute, lapTotals } from '../export/laps';
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
  ShareService,
  activeShare,
} from '../sharing/share.service';
import {
  ROUTE_STORE,
  RouteStoreError,
  type RouteStoreErrorCode,
} from '../storage/route-store';
import type { SavedRoute } from '../storage/saved-route';
import {
  BACKUP_MAX_BYTES,
  BackupError,
  type BackupErrorCode,
  backupFileName,
  backupKey,
  buildBackup,
  parseBackup,
} from '../storage/backup';

const GPX_IMPORT_CODES: readonly string[] = [
  'too_large',
  'invalid_file',
  'no_track',
  'too_short',
];

/** The browser refused the download. */
class ExportError extends Error {}

/** The most files taken in one import: more is surely a mistake, and each one is read in memory. */
export const MAX_IMPORT_FILES = 50;

/** What happened to one file of an import, as the pop-up lists it. */
export interface ImportEntry {
  file: string;
  status: 'added' | 'nothing_new' | 'failed';
  /** Routes added: one for a GPX file, any number for a routes file. */
  count: number;
  /** Translation key of why the file was not imported. */
  reasonKey?: string;
  /** Translation keys of what is worth knowing about an imported file. */
  notes: string[];
  /** The route imported without elevation, whose climb can be computed from the pop-up. */
  climbId?: string;
}

/** Which reader a file is for: by its extension, else by what its text starts with. */
function fileKind(name: string, text: string): 'gpx' | 'backup' | 'fit' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.fit')) return 'fit';
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.json')) return 'backup';
  const first = text.trimStart()[0];
  if (first === '<') return 'gpx';
  if (first === '{') return 'backup';
  return null;
}

/**
 * Saving the planned route on the device and managing the saved ones: open, rename, delete
 * (after a confirmation). A storage failure shows a translated message and leaves the planner
 * fully usable.
 */
/** The longest name a route can be given. */
export const NAME_MAX_LENGTH = 120;

@Component({
  selector: 'vl-saved-routes',
  imports: [TranslocoPipe, NgTemplateOutlet, Modal],
  templateUrl: './saved-routes.html',
  styleUrl: './saved-routes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedRoutes {
  protected readonly format = inject(FormattingService);
  protected readonly planner = inject(PlannerStore);
  private readonly routeStore = inject(ROUTE_STORE);
  private readonly download = inject(FILE_DOWNLOADER);
  private readonly analytics = inject(Analytics);
  private readonly sheet = inject(SHARE_SHEET);
  private readonly transloco = inject(TranslocoService);
  private readonly sharing = inject(ShareService);
  private readonly shareDialog = inject(ShareDialogService);
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
    | `backup_${BackupErrorCode}`
    | null
  >(null);
  /** The route whose share or unshare request is running. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  /** The route whose export formats are offered. */
  protected readonly exportingId = signal<string | null>(null);
  protected readonly exportingRoute = computed(
    () => this.routes().find((r) => r.id === this.exportingId()) ?? null,
  );
  protected readonly confirmingRoute = computed(
    () => this.routes().find((r) => r.id === this.confirmingId()) ?? null,
  );
  /** A pop-up is over the list: an error is told in it, not behind it. */
  protected readonly modalOpen = computed(
    () =>
      this.importOpen() ||
      this.exportOpen() ||
      this.confirmingRoute() !== null ||
      this.exportingRoute() !== null,
  );
  protected readonly exportFormats = EXPORT_FORMATS;
  /** The route whose opening waits for the user's yes, because a route is being planned. */
  protected readonly confirmingOpenId = signal<string | null>(null);
  protected readonly savable = this.planner.savable;
  /** The import pop-up, and what the last import did, file by file (null before any). */
  protected readonly importOpen = signal(false);
  protected readonly importResults = signal<ImportEntry[] | null>(null);
  protected readonly importBusy = signal(false);
  /** The export pop-up, and how the last export ended. */
  protected readonly exportOpen = signal(false);
  protected readonly exportResult = signal<
    'downloaded' | 'shared' | 'failed' | null
  >(null);
  /** The system share sheet can take the backup file (not Firefox desktop). */
  protected readonly canShareBackup = this.sheet.canShareFile(
    new File([], 'routes.json', { type: 'application/json' }),
  );

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
    // A short link was made or removed in the share dialog: read the records again.
    let seen = this.shareDialog.changed();
    effect(() => {
      const changed = this.shareDialog.changed();
      if (changed === seen) return;
      seen = changed;
      untracked(() => void this.refresh());
    });
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

  /** Saves the route on screen as the Save button does, and says which saved route it is. */
  async saveForSharing(): Promise<string | null> {
    await this.save();
    return this.planner.savedAs()?.id ?? null;
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
      this.analytics.report({ event: 'save' });
    });
  }

  protected openImport(): void {
    this.importResults.set(null);
    this.error.set(null);
    this.importOpen.set(true);
  }

  protected openExport(): void {
    this.exportResult.set(null);
    this.exportOpen.set(true);
  }

  /**
   * Reads the chosen files on the device, one after the other: a GPX file becomes a route, a routes
   * file adds the routes that are not there yet. A file that cannot be read does not stop the
   * others. Nothing is sent anywhere. A single GPX file is also shown on the map.
   */
  protected async importFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || this.importBusy()) return;
    this.importBusy.set(true);
    this.error.set(null);
    try {
      const entries: ImportEntry[] = [];
      let shown: SavedRoute | undefined;
      for (const file of files.slice(0, MAX_IMPORT_FILES)) {
        const done = await this.importOne(file);
        entries.push(done.entry);
        shown = done.shown;
      }
      if (files.length > MAX_IMPORT_FILES) {
        entries.push({
          file: this.transloco.translate('importDialog.others', {
            count: files.length - MAX_IMPORT_FILES,
          }),
          status: 'failed',
          count: 0,
          reasonKey: 'importDialog.errors.too_many',
          notes: [],
        });
      }
      if (files.length === 1 && shown) {
        this.planner.loadSaved(shown);
        this.planner.markSaved({ id: shown.id, name: shown.name });
      }
      this.importResults.set(entries);
    } finally {
      this.importBusy.set(false);
    }
  }

  private async importOne(
    file: File,
  ): Promise<{ entry: ImportEntry; shown?: SavedRoute }> {
    const failed = (reasonKey: string) => ({
      entry: {
        file: file.name,
        status: 'failed' as const,
        count: 0,
        reasonKey,
        notes: [],
      },
    });
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        return failed('gpxImport.errors.invalid_file');
      }
      const kind = fileKind(file.name, text);
      if (kind === 'gpx') return await this.importGpxText(file.name, text);
      if (kind === 'backup') {
        return { entry: await this.importBackupText(file, text) };
      }
      return failed(
        kind === 'fit'
          ? 'importDialog.errors.fit'
          : 'importDialog.errors.unsupported',
      );
    } catch (error) {
      if (error instanceof GpxImportError) {
        return failed(`gpxImport.errors.${error.code}`);
      }
      if (error instanceof BackupError) {
        return failed(`backup.errors.${error.code}`);
      }
      return failed(
        `saved.errors.${error instanceof RouteStoreError ? error.code : 'unknown'}`,
      );
    }
  }

  private async importGpxText(
    fileName: string,
    text: string,
  ): Promise<{ entry: ImportEntry; shown: SavedRoute }> {
    const imported = parseGpx(text, this.planner.profile());
    const name =
      imported.name || fileName.replace(/\.gpx$/i, '').trim() || 'GPX';
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
    const notes = [
      ...(imported.ascentMeters === null ? ['importDialog.noElevation'] : []),
      ...(imported.thinned ? ['importDialog.thinned'] : []),
    ];
    return {
      shown: saved,
      entry: {
        file: fileName,
        status: 'added',
        count: 1,
        notes,
        ...(imported.ascentMeters === null ? { climbId: saved.id } : {}),
      },
    };
  }

  /**
   * Adds the routes of a routes file that are not there yet (same name, profile, points and
   * length). A file out of shape is refused whole.
   */
  private async importBackupText(
    file: File,
    text: string,
  ): Promise<ImportEntry> {
    if (file.size > BACKUP_MAX_BYTES) throw new BackupError('too_large');
    const result = parseBackup(text);
    if (!result.ok) throw new BackupError(result.code);
    const known = new Set((await this.routeStore.list()).map(backupKey));
    let added = 0;
    for (const { laps, ...route } of result.routes) {
      const key = backupKey(route);
      if (known.has(key)) continue;
      known.add(key);
      let saved = await this.routeStore.save(route);
      if (laps) saved = await this.routeStore.setLaps(saved.id, laps);
      this.routes.update((routes) => [saved, ...routes]);
      added += 1;
    }
    return {
      file: file.name,
      status: added > 0 ? 'added' : 'nothing_new',
      count: added,
      notes: [],
    };
  }

  /** The translation key of the line that tells what became of a file. */
  protected entryKey(entry: ImportEntry): string {
    if (entry.status === 'failed')
      return entry.reasonKey ?? 'saved.errors.unknown';
    return entry.status === 'added'
      ? 'importDialog.fileAdded'
      : 'importDialog.fileNothingNew';
  }

  protected readonly importedCount = computed(() =>
    (this.importResults() ?? []).reduce((sum, entry) => sum + entry.count, 0),
  );

  /**
   * Every saved route in one file, built on the device: downloaded, or handed to the system share
   * sheet. The delete token of a route shared by the server is not written. The pop-up says how it
   * ended.
   */
  protected async exportAll(
    how: 'download' | 'share' = 'download',
  ): Promise<void> {
    this.exportResult.set(null);
    try {
      const routes = await this.routeStore.list();
      const now = new Date();
      const text = buildBackup(routes, now);
      const name = backupFileName(now);
      if (how === 'download') {
        try {
          this.download(text, name, 'application/json');
        } catch {
          throw new ExportError();
        }
        this.exportResult.set('downloaded');
        return;
      }
      const outcome = await this.sheet.shareFile(
        new File([text], name, { type: 'application/json' }),
      );
      if (outcome === 'failed') throw new ExportError();
      if (outcome === 'shared') this.exportResult.set('shared');
    } catch {
      this.exportResult.set('failed');
    }
  }

  /** Computes the climb of a route imported without elevation, from the import pop-up. */
  protected async computeImportedClimb(id: string): Promise<void> {
    await this.computeClimb(id, this.planner.savedAs()?.id === id);
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
      // The pop-up that imported it no longer offers to compute the climb it now has.
      this.importResults.update((entries) =>
        entries
          ? entries.map((entry) =>
              entry.climbId === id
                ? {
                    ...entry,
                    climbId: undefined,
                    notes: entry.notes.filter(
                      (note) => note !== 'importDialog.noElevation',
                    ),
                  }
                : entry,
            )
          : entries,
      );
    });
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

  /** The system share sheet can take a GPX file (not Firefox desktop; Chrome limits the types). */
  protected readonly canShareGpx = this.sheet.canShareFile(
    new File([], 'route.gpx', { type: 'application/gpx+xml' }),
  );

  /**
   * Builds the file on the device from the stored geometry and downloads it, or hands it to the
   * system share sheet when `how` is `share` (the GPX only).
   */
  protected async exportAs(
    id: string,
    format: ExportFormat,
    how: 'download' | 'share' = 'download',
  ): Promise<void> {
    this.exportingId.set(null);
    await this.attempt(async () => {
      const saved = await this.routeStore.get(id);
      if (!saved) {
        this.routes.update((routes) => routes.filter((r) => r.id !== id));
        throw new RouteStoreError('not_found');
      }
      let file;
      try {
        file = buildExportFile(
          saved,
          format,
          this.pointNames(saved),
          this.lapsOf(saved),
        );
      } catch {
        throw new ExportError();
      }
      const { content, fileName: name, mimeType: mime } = file;
      if (how === 'download') {
        try {
          this.download(content, name, mime);
        } catch {
          throw new ExportError();
        }
        this.analytics.report({ event: `export_${format}` });
        return;
      }
      const outcome = await this.sheet.shareFile(
        new File([content], name, { type: mime }),
        saved.name,
      );
      if (outcome === 'failed') throw new ExportError();
      if (outcome === 'shared') {
        this.analytics.report({ event: `export_${format}` });
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
    if (code.startsWith('backup_')) {
      return `backup.errors.${code.slice('backup_'.length)}`;
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
    return activeShare(route)
      ? 'sharing.confirmDeleteShared'
      : 'saved.confirmDelete';
  }

  /** Opens the share dialog for a saved route. */
  protected openShare(route: SavedRoute): void {
    this.shareDialog.open({ savedId: route.id });
  }

  /** When the short link of a route stops working, while its copy is on the server. */
  protected shareUntil(route: SavedRoute): number | null {
    return activeShare(route)?.expiresAt ?? null;
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
              : error instanceof BackupError
                ? `backup_${error.code}`
                : 'unknown',
      );
    }
  }
}
