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
  const button = root.querySelector('button') as HTMLButtonElement;
  const options = () =>
    Array.from(root.querySelectorAll<HTMLElement>('[role=option]'));
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    button.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return { fixture, root, button, options, press, changed };
}

describe('ProfileSelect', () => {
  it('shows the title and the description of the selected profile', async () => {
    const { root, button, options } = await setup();
    expect(button.getAttribute('role')).toBe('combobox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('.title')?.textContent).toBe('Gravel');
    expect(button.querySelector('.description')?.textContent).toBe(
      'Gravel bike: tracks and quiet roads',
    );
    expect(root.querySelector('.label')?.textContent).toBe('Profile');
    expect(options()).toHaveLength(0);
  });

  it('opens on a click and picks an option with its description', async () => {
    const { fixture, root, button, options, changed } = await setup();
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[role=listbox]')).not.toBeNull();
    expect(
      options().map((o) => o.querySelector('.title')?.textContent),
    ).toEqual(['Road', 'Gravel', 'Trail']);
    expect(options()[2].querySelector('.description')?.textContent).toBe(
      'Running: footpaths and tracks first',
    );
    // The selected one is marked.
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(options()[1].querySelector('.check')).not.toBeNull();
    options()[2].click();
    fixture.detectChanges();
    expect(changed).toEqual(['trail']);
    expect(options()).toHaveLength(0);
  });

  it('says nothing when the selected profile is picked again', async () => {
    const { fixture, button, options, changed } = await setup();
    button.click();
    fixture.detectChanges();
    options()[1].click();
    fixture.detectChanges();
    expect(changed).toEqual([]);
    expect(options()).toHaveLength(0);
  });

  it('is used with the keys', async () => {
    const { button, options, press, changed } = await setup();
    // Opens on the selected profile.
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(button.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    press('ArrowDown');
    press('ArrowDown');
    expect(button.getAttribute('aria-activedescendant')).toBe(options()[2].id);
    press('Home');
    expect(button.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()[0].classList.contains('options__active')).toBe(true);
    press('End');
    press('ArrowUp');
    press('ArrowUp');
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(changed).toEqual(['road']);
    expect(options()).toHaveLength(0);
    expect(button.getAttribute('aria-activedescendant')).toBeNull();

    press(' ');
    expect(options()).toHaveLength(3);
    press('End');
    press(' ');
    expect(changed).toEqual(['road', 'trail']);
  });

  it('closes without a change on Escape, on a click outside and when it loses the focus', async () => {
    const { fixture, button, options, press, changed } = await setup();
    press('Enter');
    press('ArrowDown');
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(options()).toHaveLength(0);

    button.click();
    fixture.detectChanges();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(options()).toHaveLength(0);

    button.click();
    fixture.detectChanges();
    button.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(options()).toHaveLength(0);
    expect(changed).toEqual([]);
  });

  it('leaves the shortcuts of the page alone', async () => {
    const { options, press } = await setup();
    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('a').defaultPrevented).toBe(false);
    expect(options()).toHaveLength(0);
  });
});
