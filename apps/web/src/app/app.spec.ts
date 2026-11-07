import { TestBed } from '@angular/core/testing';
import { provideFakeMap } from '../testing/fake-map';
import { provideTestTransloco } from '../testing/transloco-testing';
import { createApiClient } from '@voie-libre/api-client';
import { App } from './app';
import { API_CLIENT } from './core/api/api-client';
import { HealthService } from './core/api/health.service';
import { LanguageService } from './core/i18n/language.service';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideTestTransloco(),
        provideFakeMap(),
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async () =>
              new Response(
                JSON.stringify({ status: 'ok', api: 'up', database: 'up' }),
                { headers: { 'content-type': 'application/json' } },
              ),
          }),
        },
      ],
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

  it('shows the API status, translated', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    // fetch is not tracked by whenStable: wait for the health check explicitly.
    await TestBed.inject(HealthService).check();
    fixture.detectChanges();
    const status = (fixture.nativeElement as HTMLElement).querySelector(
      '.api-status',
    );
    expect(status?.getAttribute('data-status')).toBe('ok');
    expect(status?.textContent).toContain('API: online');
  });
});
