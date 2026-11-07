/** Languages the UI is translated into. English is the default and the fallback. */
export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

export function isSupportedLanguage(
  value: string | null | undefined,
): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

/**
 * Picks the first candidate (for example `navigator.languages`) whose primary
 * subtag is supported, so `fr-CA` gives `fr`. Falls back to the default language.
 */
export function pickLanguage(candidates: readonly string[]): Language {
  for (const candidate of candidates) {
    const primary = candidate.toLowerCase().split('-')[0];
    if (isSupportedLanguage(primary)) {
      return primary;
    }
  }
  return DEFAULT_LANGUAGE;
}
