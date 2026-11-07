import { TranslocoConfig, translocoConfig } from '@jsverse/transloco';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './languages';

/** Single source of truth for the Transloco setup, shared by the app and the tests. */
export function createTranslocoConfig(
  prodMode: boolean,
): Partial<TranslocoConfig> {
  return translocoConfig({
    availableLangs: [...SUPPORTED_LANGUAGES],
    defaultLang: DEFAULT_LANGUAGE,
    fallbackLang: DEFAULT_LANGUAGE,
    reRenderOnLangChange: true,
    prodMode,
  });
}
