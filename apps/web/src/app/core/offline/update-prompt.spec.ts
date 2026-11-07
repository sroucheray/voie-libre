import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { LanguageService } from '../i18n/language.service';
import { RELOAD_PAGE } from './app-update';
import { UpdatePrompt } from './update-prompt';

const ready = { type: 'VERSION_READY' } as VersionEvent;
const detected = { type: 'VERSION_DETECTED' } as VersionEvent;

function setup(isEnabled = true) {
  const events = new Subject<VersionEvent>();
  const activateUpdate = vi.fn(async () => true);
  const reload = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideTestTransloco(),
      { provide: RELOAD_PAGE, useValue: reload },
      {
        provide: SwUpdate,
        useValue: { isEnabled, versionUpdates: events, activateUpdate },
      },
    ],
  });
  TestBed.inject(LanguageService).use('en');
  const fixture = TestBed.createComponent(UpdatePrompt);
  return { fixture, events, activateUpdate, reload };
}

describe('UpdatePrompt', () => {
  it('shows nothing until a new version is ready', async () => {
    const { fixture, events } = setup();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.update')).toBeNull();
    events.next(detected);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.update')).toBeNull();
    events.next(ready);
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('.update')?.textContent,
    ).toContain('new version');
  });

  it('activates the new version, then reloads, only when the user asks', async () => {
    const { fixture, events, activateUpdate, reload } = setup();
    events.next(ready);
    await fixture.whenStable();
    expect(reload).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('.reload').click();
    await fixture.whenStable();
    expect(activateUpdate).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads even when activating fails', async () => {
    const { fixture, events, activateUpdate, reload } = setup();
    activateUpdate.mockRejectedValueOnce(new Error('no worker'));
    events.next(ready);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.reload').click();
    await fixture.whenStable();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('hides when dismissed, without activating anything', async () => {
    const { fixture, events, activateUpdate } = setup();
    events.next(ready);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.later').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.update')).toBeNull();
    expect(activateUpdate).not.toHaveBeenCalled();
  });

  it('does nothing where the service worker is off (development)', async () => {
    const { fixture, events } = setup(false);
    events.next(ready);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.update')).toBeNull();
  });
});
