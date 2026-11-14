import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { CopyLinkButton } from './copy-link-button';
import { decodeRouteLink, type RouteLink } from './route-link';

const link: RouteLink = {
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  profile: 'road',
  loop: null,
  name: 'Clermont to Issoire',
};

@Component({
  imports: [CopyLinkButton],
  template: `<vl-copy-link-button
    [link]="link()"
    name="Clermont to Issoire"
  />`,
})
class Host {
  readonly link = signal<RouteLink | null>(link);
}

describe('CopyLinkButton', () => {
  let written: string[];
  let writeText: (text: string) => Promise<void>;

  beforeEach(async () => {
    written = [];
    writeText = async (text) => {
      written.push(text);
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => writeText(text) },
    });
    await TestBed.configureTestingModule({
      providers: [provideTestTransloco()],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      button: el.querySelector<HTMLButtonElement>('button'),
    };
  }

  it('copies a link that reads back as the route, and says who can see it', async () => {
    const { fixture, el, button } = create();
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(written).toHaveLength(1);
    const url = new URL(written[0]);
    expect(url.pathname).toBe('/r');
    const result = decodeRouteLink(url.hash);
    expect(result).toEqual({ ok: true, link });
    expect(el.textContent).toContain('Link copied.');
    expect(el.textContent).toContain('Anyone who has this link');
  });

  it('is off while there is no route', () => {
    const { fixture, button } = create();
    fixture.componentInstance.link.set(null);
    fixture.detectChanges();
    expect(button?.disabled).toBe(true);
  });

  it('shows the link to select by hand when the clipboard refuses', async () => {
    writeText = async () => {
      throw new Error('denied');
    };
    const { fixture, el, button } = create();
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('could not be copied');
    expect(el.querySelector<HTMLInputElement>('input')?.value).toContain(
      '/r#v=1',
    );
  });
});
