import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { LanguageService } from '../i18n/language.service';
import { ABOUT_LINKS, type AboutLinks } from './about-config';
import { About } from './about';

function setup(links?: Partial<AboutLinks>) {
  TestBed.configureTestingModule({
    providers: [
      provideTestTransloco(),
      ...(links
        ? [
            {
              provide: ABOUT_LINKS,
              useValue: {
                repository: 'https://example.test/repo',
                donation: null,
                ...links,
              },
            },
          ]
        : []),
    ],
  });
  TestBed.inject(LanguageService).use('en');
  const fixture = TestBed.createComponent(About);
  const root = fixture.nativeElement as HTMLElement;
  const open = async () => {
    root.querySelector<HTMLButtonElement>('.about-button')?.click();
    await fixture.whenStable();
  };
  return { fixture, root, open };
}

describe('About', () => {
  it('shows only the button until it is pressed', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    expect(root.querySelector('.about-button')).not.toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens a dialog with the repository, the issues and the licence', async () => {
    const { root, open } = setup({ repository: 'https://example.test/repo' });
    await open();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    const hrefs = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('.about__links a'),
    ).map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://example.test/repo',
      'https://example.test/repo/issues',
      'https://example.test/repo/blob/main/LICENSE',
    ]);
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a')) {
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('target')).toBe('_blank');
    }
  });

  it('leaves the support part out while there is no donation page', async () => {
    const { root, open } = setup({ donation: null });
    await open();
    expect(root.querySelector('.about__donate')).toBeNull();
  });

  it('offers a link to the donation page once there is one', async () => {
    const { root, open } = setup({ donation: 'https://liberapay.test/me' });
    await open();
    const donate = root.querySelector<HTMLAnchorElement>('.about__donate');
    expect(donate?.getAttribute('href')).toBe('https://liberapay.test/me');
  });

  it('closes with the button, the backdrop and Escape', async () => {
    const { fixture, root, open } = setup();
    for (const close of [
      () => root.querySelector<HTMLButtonElement>('.about__close')?.click(),
      () => root.querySelector<HTMLButtonElement>('.about__backdrop')?.click(),
      () =>
        root
          .querySelector('.about__box')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ]) {
      await open();
      expect(root.querySelector('[role="dialog"]')).not.toBeNull();
      close();
      await fixture.whenStable();
      expect(root.querySelector('[role="dialog"]')).toBeNull();
    }
  });

  it('shows the version of the app', async () => {
    const { root, open } = setup();
    await open();
    expect(root.querySelector('.about__version')?.textContent?.trim()).toBe(
      'Version dev',
    );
  });
});
