import { Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { of } from 'rxjs';
import { createTranslocoConfig } from '../app/core/i18n/transloco-config';
import en from '../../public/i18n/en.json';
import fr from '../../public/i18n/fr.json';

const TRANSLATIONS: Record<string, Translation> = { en, fr };

/** Serves the real translation files from memory, so tests exercise the shipped keys. */
@Injectable()
class InMemoryLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return of(TRANSLATIONS[lang] ?? en);
  }
}

export function provideTestTransloco() {
  return provideTransloco({
    config: createTranslocoConfig(false),
    loader: InMemoryLoader,
  });
}
