import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { LanguageService } from './language.service';

const KEY = 'voie-libre.language';

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

describe('LanguageService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    setBrowserLanguages(['en-US']);
    TestBed.configureTestingModule({ providers: [provideTestTransloco()] });
  });

  it('starts from the browser language when nothing is stored', () => {
    setBrowserLanguages(['de-DE', 'fr-FR']);
    const service = TestBed.inject(LanguageService);
    service.init();
    expect(service.current()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('falls back to English for an unsupported browser language', () => {
    setBrowserLanguages(['de-DE']);
    const service = TestBed.inject(LanguageService);
    service.init();
    expect(service.current()).toBe('en');
  });

  it('prefers the remembered language over the browser language', () => {
    localStorage.setItem(KEY, 'fr');
    setBrowserLanguages(['en-US']);
    const service = TestBed.inject(LanguageService);
    service.init();
    expect(service.current()).toBe('fr');
  });

  it('ignores an unsupported remembered value', () => {
    localStorage.setItem(KEY, 'xx');
    const service = TestBed.inject(LanguageService);
    service.init();
    expect(service.current()).toBe('en');
  });

  it('switches language, updates <html lang> and remembers the choice', () => {
    const service = TestBed.inject(LanguageService);
    service.init();
    service.use('fr');
    expect(service.current()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem(KEY)).toBe('fr');
  });

  it('still works when storage throws', () => {
    const service = TestBed.inject(LanguageService);
    service.init();
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(() => service.use('fr')).not.toThrow();
    expect(service.current()).toBe('fr');
    expect(() => service.init()).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
