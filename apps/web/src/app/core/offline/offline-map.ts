import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { PlannerStore } from '../../planner/planner-store';
import { FormattingService } from '../format/formatting.service';
import { LanguageService } from '../i18n/language.service';
import { MapViewport } from '../map/map-viewport';
import { OfflineBasemap } from './offline-basemap';

/**
 * The offline panel: keep the corridor around the route on screen, or the view on screen, and
 * remove what was kept. The user sees what an area takes (tiles, size) before agreeing. The map
 * reads the kept areas by itself.
 */
@Component({
  selector: 'vl-offline-map',
  imports: [TranslocoPipe],
  templateUrl: './offline-map.html',
  styleUrl: './offline-map.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflineMap {
  protected readonly offline = inject(OfflineBasemap);
  protected readonly format = inject(FormattingService);
  private readonly planner = inject(PlannerStore);
  private readonly viewport = inject(MapViewport);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  protected readonly percent = computed(() =>
    Math.round(this.offline.progress() * 100),
  );
  protected readonly busy = computed(
    () => this.offline.state() !== 'idle' || this.offline.pending() !== null,
  );
  protected readonly route = computed(() =>
    this.planner
      .selectedGeometry()
      .map(([lon, lat]) => [lon, lat] as [number, number]),
  );
  protected readonly canKeepRoute = computed(() => this.route().length >= 2);
  protected readonly canKeepView = computed(() => this.viewport.box() !== null);

  /** The name the area will get if the user agrees. */
  private readonly name = signal('');

  protected keepRoute(): void {
    const distance =
      this.planner.routes()[this.planner.selectedIndex()]?.distanceMeters;
    this.name.set(
      this.nameOf('offline.names.route', {
        distance: this.format.distance(distance ?? 0),
      }),
    );
    void this.offline.plan({ kind: 'route', line: this.route() });
  }

  protected keepView(): void {
    const box = this.viewport.box();
    if (!box) return;
    this.name.set(this.nameOf('offline.names.view', {}));
    void this.offline.plan({ kind: 'view', box });
  }

  protected confirm(): void {
    void this.offline.keep(this.name());
  }

  private nameOf(key: string, params: Record<string, unknown>): string {
    return this.transloco.translate(
      key,
      { ...params, date: this.format.date(Date.now()) },
      this.language.current(),
    );
  }
}
