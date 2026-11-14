import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

/** The event Chrome, Edge and Android browsers fire when the app can be installed. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installing the app from itself. Where the browser offers it (`beforeinstallprompt`) the event is
 * kept and "Install" opens the browser's own dialog; on iPhone and iPad, which have no such event,
 * the About window says how to do it by hand. Created at start-up so that the event, which can come
 * early, is not missed.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstall {
  private readonly win = inject(DOCUMENT).defaultView;
  private readonly deferred = signal<BeforeInstallPromptEvent | null>(null);
  private readonly installed = signal(this.runsInstalled());

  /** The browser can open its install dialog now. */
  readonly canPrompt = computed(
    () => this.deferred() !== null && !this.installed(),
  );
  /** iPhone or iPad Safari: no dialog to open, only a gesture to explain. */
  readonly iosHint = computed(() => this.isIos() && !this.installed());

  constructor() {
    this.win?.addEventListener('beforeinstallprompt', (event) => {
      // Keeps the browser's own mini bar away: the button decides when to ask.
      event.preventDefault();
      this.deferred.set(event as BeforeInstallPromptEvent);
    });
    this.win?.addEventListener('appinstalled', () => {
      this.deferred.set(null);
      this.installed.set(true);
    });
  }

  /** Opens the browser's install dialog; the event can only be used once. */
  async install(): Promise<void> {
    const event = this.deferred();
    if (!event) return;
    this.deferred.set(null);
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') this.installed.set(true);
  }

  /** Opened from its icon, in its own window: already installed. */
  private runsInstalled(): boolean {
    const win = this.win;
    if (!win) return false;
    return (
      win.matchMedia?.('(display-mode: standalone)').matches === true ||
      (win.navigator as Navigator & { standalone?: boolean }).standalone ===
        true
    );
  }

  private isIos(): boolean {
    const navigator = this.win?.navigator;
    if (!navigator) return false;
    const touchMac =
      navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || touchMac;
  }
}
