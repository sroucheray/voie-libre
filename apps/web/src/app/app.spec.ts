import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../testing/transloco-testing';
import { App } from './app';
import { LanguageService } from './core/i18n/language.service';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideTestTransloco()],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  it('renders the title and tagline in English by default', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('Voie Libre');
    expect(element.querySelector('main p')?.textContent).toContain(
      'Plan road, gravel and trail routes',
    );
  });

  it('switches the whole page to French through the language selector', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'fr';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(element.querySelector('main p')?.textContent).toContain(
      'Planifiez vos parcours',
    );
    expect(select.getAttribute('aria-label')).toBe('Langue');
  });

  it('offers each language written in itself', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('option'),
    ).map((o) => o.textContent?.trim());
    expect(options).toEqual(['English', 'français']);
  });
});
