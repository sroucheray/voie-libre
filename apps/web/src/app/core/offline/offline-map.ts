import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormattingService } from '../format/formatting.service';
import { OfflineBasemap } from './offline-basemap';

/**
 * Download of the basemap for offline use: a button, a progress bar, and the means to remove the
 * copy. The map reads the downloaded copy automatically.
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
  protected readonly percent = computed(() =>
    Math.round(this.offline.progress() * 100),
  );
}
