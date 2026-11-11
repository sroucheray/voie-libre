import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { PROFILES, type Profile } from './planner-store';
import { ProfileSelect } from './profile-select';

async function setup(value: Profile = 'gravel') {
  TestBed.configureTestingModule({ providers: [provideTestTransloco()] });
  TestBed.inject(LanguageService).use('en');
  const fixture = TestBed.createComponent(ProfileSelect);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('profiles', PROFILES);
  const changed: Profile[] = [];
  fixture.componentInstance.changed.subscribe((profile) =>
    changed.push(profile),
  );
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const radios = () =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('[role=radio]'));
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    radios()[1].dispatchEvent(event);
    return event;
  };
  return { fixture, root, radios, press, changed };
}

describe('ProfileSelect', () => {
  it('shows one button per profile and the description of the selected one', async () => {
    const { root, radios } = await setup();
    expect(root.querySelector('[role=radiogroup]')).not.toBeNull();
    expect(radios().map((r) => r.querySelector('.title')?.textContent)).toEqual(
      ['Road', 'Gravel', 'Trail'],
    );
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(root.querySelector('.description')?.textContent?.trim()).toBe(
      'Gravel bike: tracks and quiet roads',
    );
    expect(root.querySelector('.label')?.textContent).toBe('Profile');
  });

  it('picks a profile on a click and says nothing for the selected one', async () => {
    const { radios, changed } = await setup();
    radios()[2].click();
    radios()[1].click();
    expect(changed).toEqual(['trail']);
  });

  it('moves the choice with the arrows, Home and End', async () => {
    const { press, changed } = await setup();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(press('ArrowLeft').defaultPrevented).toBe(true);
    press('Home');
    press('End');
    expect(changed).toEqual(['trail', 'road', 'road', 'trail']);
  });

  it('leaves the shortcuts of the page alone', async () => {
    const { press, changed } = await setup();
    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('a').defaultPrevented).toBe(false);
    expect(changed).toEqual([]);
  });
});
