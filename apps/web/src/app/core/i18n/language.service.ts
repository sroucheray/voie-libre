import { DOCUMENT } from '@angular/common';
import { Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  Language,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  pickLanguage,
} from './languages';

const STORAGE_KEY = 'voie-libre.language';

/** Holds the active UI language: remembered choice, then browser language, then English. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  readonly supported = SUPPORTED_LANGUAGES;
  readonly current: Signal<Language> = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  }) as Signal<Language>;

  /** Applies the stored or detected language. Called once at startup. */
  init(): void {
    const stored = this.readStored();
    const browser = this.document.defaultView?.navigator?.languages ?? [];
    this.apply(isSupportedLanguage(stored) ? stored : pickLanguage(browser));
  }

  /** Switches language and remembers the choice. */
  use(language: Language): void {
    if (!isSupportedLanguage(language)) {
      return;
    }
    this.apply(language);
    this.store(language);
  }

  private apply(language: Language): void {
    this.transloco.setActiveLang(language);
    this.document.documentElement.lang = language;
  }

  // Storage can be missing or throw (private window, blocked site data): never depend on it.
  private readStored(): string | null {
    try {
      return (
        this.document.defaultView?.localStorage.getItem(STORAGE_KEY) ?? null
      );
    } catch {
      return null;
    }
  }

  private store(language: Language): void {
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore: the language still applies for this session
    }
  }
}
