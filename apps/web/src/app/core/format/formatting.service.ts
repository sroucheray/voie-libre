import { Injectable, computed, inject } from '@angular/core';
import { LanguageService } from '../i18n/language.service';
import {
  formatBytes,
  formatDate,
  formatDistance,
  formatDuration,
  formatElevation,
  formatNumber,
} from './format';

/**
 * Formats values for the active UI language. Components call these methods in templates
 * or computed signals; they re-evaluate when the language changes because they read the signal.
 */
@Injectable({ providedIn: 'root' })
export class FormattingService {
  private readonly language = inject(LanguageService);
  readonly locale = computed(() => this.language.current());

  number(value: number, options?: Intl.NumberFormatOptions): string {
    return formatNumber(value, this.locale(), options);
  }

  distance(meters: number): string {
    return formatDistance(meters, this.locale());
  }

  elevation(meters: number): string {
    return formatElevation(meters, this.locale());
  }

  duration(seconds: number): string {
    return formatDuration(seconds, this.locale());
  }

  bytes(size: number): string {
    return formatBytes(size, this.locale());
  }

  date(
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return formatDate(value, this.locale(), options);
  }
}
