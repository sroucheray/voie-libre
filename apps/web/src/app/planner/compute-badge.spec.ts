import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { COMPUTING_LONG_AFTER_SECONDS, ComputeBadge } from './compute-badge';

describe('ComputeBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideTestTransloco()] });
    TestBed.inject(LanguageService).use('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render(active: boolean) {
    const fixture = TestBed.createComponent(ComputeBadge);
    fixture.componentRef.setInput('active', active);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      badge: () => root.querySelector('.badge'),
      text: () => root.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      async set(active: boolean) {
        fixture.componentRef.setInput('active', active);
        TestBed.tick();
        fixture.detectChanges();
      },
      async wait(seconds: number) {
        await vi.advanceTimersByTimeAsync(seconds * 1000);
        TestBed.tick();
        fixture.detectChanges();
      },
    };
  }

  it('keeps its live region, empty, while nothing is computing', () => {
    const view = render(false);
    expect(view.root.querySelector('[role="status"]')).not.toBeNull();
    expect(view.badge()).toBeNull();
    expect(view.text()).toBe('');
  });

  it('says that the route is being computed, with a spinner that screen readers skip', () => {
    const view = render(true);
    expect(view.text()).toBe('Computing the route…');
    expect(
      view.root.querySelector('.spinner')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('counts the seconds and says long routes can take a minute, once it lasts', async () => {
    const view = render(true);
    await view.wait(COMPUTING_LONG_AFTER_SECONDS - 1);
    expect(view.text()).toBe('Computing the route…');
    await view.wait(1);
    expect(view.text()).toContain(
      `${COMPUTING_LONG_AFTER_SECONDS} s. Long routes can take a minute.`,
    );
    await view.wait(4);
    expect(view.text()).toContain(`${COMPUTING_LONG_AFTER_SECONDS + 4} s.`);
  });

  it('goes when the computation is over, and counts from zero the next time', async () => {
    const view = render(true);
    await view.wait(COMPUTING_LONG_AFTER_SECONDS + 2);
    await view.set(false);
    expect(view.badge()).toBeNull();
    await view.set(true);
    expect(view.text()).toBe('Computing the route…');
    await view.wait(2);
    expect(view.text()).toBe('Computing the route…');
  });
});
