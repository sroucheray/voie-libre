import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  pickLanguage,
} from './languages';

describe('pickLanguage', () => {
  it('returns a supported language as is', () => {
    expect(pickLanguage(['fr'])).toBe('fr');
  });

  it('matches on the primary subtag', () => {
    expect(pickLanguage(['fr-CA'])).toBe('fr');
    expect(pickLanguage(['EN-us'])).toBe('en');
  });

  it('takes the first supported candidate in order', () => {
    expect(pickLanguage(['de-DE', 'fr-FR', 'en-GB'])).toBe('fr');
  });

  it('falls back to English when nothing matches or the list is empty', () => {
    expect(pickLanguage(['de', 'es'])).toBe(DEFAULT_LANGUAGE);
    expect(pickLanguage([])).toBe('en');
  });
});

describe('isSupportedLanguage', () => {
  it('only accepts the shipped languages', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('fr')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });
});
