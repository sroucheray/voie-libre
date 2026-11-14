import { TestBed } from '@angular/core/testing';
import { PwaInstall } from './pwa-install';

function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

describe('PwaInstall', () => {
  const matchMedia = window.matchMedia;
  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = matchMedia;
  });

  it('keeps the install event, holds the browser back and uses it once', async () => {
    const install = TestBed.inject(PwaInstall);
    expect(install.canPrompt()).toBe(false);
    const { event, prompt } = promptEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(install.canPrompt()).toBe(true);
    await install.install();
    expect(prompt).toHaveBeenCalledTimes(1);
    // Accepted: it is installed, and the event cannot be used again.
    expect(install.canPrompt()).toBe(false);
    await install.install();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('stops offering once the browser says the app is installed', () => {
    const install = TestBed.inject(PwaInstall);
    window.dispatchEvent(promptEvent().event);
    expect(install.canPrompt()).toBe(true);
    window.dispatchEvent(new Event('appinstalled'));
    expect(install.canPrompt()).toBe(false);
  });

  it('offers nothing in the window of an installed app', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const install = TestBed.inject(PwaInstall);
    window.dispatchEvent(promptEvent().event);
    expect(install.canPrompt()).toBe(false);
    expect(install.iosHint()).toBe(false);
  });

  it('explains the gesture on an iPhone, where there is no dialog to open', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    );
    const install = TestBed.inject(PwaInstall);
    expect(install.iosHint()).toBe(true);
    expect(install.canPrompt()).toBe(false);
  });
});
