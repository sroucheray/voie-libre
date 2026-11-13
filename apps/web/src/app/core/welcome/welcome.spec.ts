import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { LanguageService } from '../i18n/language.service';
import { Welcome } from './welcome';
import { WELCOME_SEEN_KEY, WelcomeScreen } from './welcome-screen';

function setup() {
  TestBed.configureTestingModule({ providers: [provideTestTransloco()] });
  TestBed.inject(LanguageService).use('en');
  const fixture = TestBed.createComponent(Welcome);
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('Welcome', () => {
  beforeEach(() => localStorage.removeItem(WELCOME_SEEN_KEY));
  afterEach(() => localStorage.removeItem(WELCOME_SEEN_KEY));

  it('opens on the first visit and says the app is free, with the donation link', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(root.querySelector('.welcome__free')?.textContent).toContain('free');
    expect(
      root.querySelector<HTMLAnchorElement>('.welcome__donate')?.href,
    ).toBe('https://liberapay.com/sroucheray');
    expect(root.querySelectorAll('.welcome__ways li')).toHaveLength(2);
  });

  it('closes, remembers it, and stays closed on the next visit', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    // The window must be there before it is closed: a missing button must fail here, not later.
    const start = root.querySelector<HTMLButtonElement>('.welcome__start');
    expect(start).not.toBeNull();
    start!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(localStorage.getItem(WELCOME_SEEN_KEY)).toBe('1');
    TestBed.resetTestingModule();
    expect(TestBed.inject(WelcomeScreen).open()).toBe(false);
  });

  it('comes back when asked to', async () => {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
    const { fixture, root } = setup();
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    TestBed.inject(WelcomeScreen).show();
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
