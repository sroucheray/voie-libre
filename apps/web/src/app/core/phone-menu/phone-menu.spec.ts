import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { provideFakeMap } from '../../../testing/fake-map';
import { AboutScreen } from '../about/about-screen';
import { LanguageService } from '../i18n/language.service';
import { PhoneMenu } from './phone-menu';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideTestTransloco(), provideFakeMap()],
  });
  TestBed.inject(LanguageService).use('en');
  const fixture = TestBed.createComponent(PhoneMenu);
  const root = fixture.nativeElement as HTMLElement;
  const open = async () => {
    root.querySelector<HTMLButtonElement>('.logo-button')?.click();
    await fixture.whenStable();
  };
  return { fixture, root, open };
}

describe('PhoneMenu', () => {
  it('is only a logo button until it is pressed', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    expect(root.querySelector('.logo-button')).not.toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('holds the language, the offline actions, the support link and About', async () => {
    const { root, open } = setup();
    await open();
    expect(root.querySelectorAll('.language button')).toHaveLength(2);
    expect(root.querySelector('.keep-route')).not.toBeNull();
    expect(root.querySelector('.keep-view')).not.toBeNull();
    const support = root.querySelector<HTMLAnchorElement>('.links a');
    expect(support?.href).toBe('https://liberapay.com/sroucheray');
    expect(support?.target).toBe('_blank');
  });

  it('switches the language and marks the current one', async () => {
    const { root, open, fixture } = setup();
    await open();
    const [, french] = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.language button'),
    );
    french.click();
    await fixture.whenStable();
    expect(TestBed.inject(LanguageService).current()).toBe('fr');
    expect(french.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the About window and closes itself', async () => {
    const { root, open, fixture } = setup();
    await open();
    const buttons = root.querySelectorAll<HTMLButtonElement>('.links button');
    buttons[buttons.length - 1].click();
    await fixture.whenStable();
    expect(TestBed.inject(AboutScreen).open()).toBe(true);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes with Escape', async () => {
    const { root, open, fixture } = setup();
    await open();
    root
      .querySelector('[role="dialog"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
});
