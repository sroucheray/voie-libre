import { InjectionToken } from '@angular/core';

/** How a trip to the system share sheet ended. */
export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/**
 * The system share sheet (Web Share API): where it exists, it hands a link or a file to any app
 * on the device, Nearby Share, Quick Share and AirDrop included. Behind a token so that tests,
 * and later the Capacitor share plugin, can replace the browser's own.
 */
export interface ShareSheet {
  /** True when the browser can share a link. */
  canShareUrl(): boolean;
  /** True when the browser can share this file (it checks the file type). */
  canShareFile(file: File): boolean;
  shareUrl(data: { title?: string; url: string }): Promise<ShareOutcome>;
  shareFile(file: File, title?: string): Promise<ShareOutcome>;
}

async function run(share: () => Promise<void>): Promise<ShareOutcome> {
  try {
    await share();
    return 'shared';
  } catch (error) {
    // Closing the sheet without choosing an app is not an error.
    return (error as { name?: string })?.name === 'AbortError'
      ? 'cancelled'
      : 'failed';
  }
}

const canShare = (data: ShareData): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  (typeof navigator.canShare !== 'function' || navigator.canShare(data));

/** The browser's `navigator.share`: missing on Firefox desktop, hence the checks. */
export const browserShareSheet: ShareSheet = {
  canShareUrl: () => canShare({ url: 'https://voielibre.app/' }),
  canShareFile: (file) =>
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] }),
  shareUrl: (data) => run(() => navigator.share(data)),
  shareFile: (file, title) =>
    run(() => navigator.share({ files: [file], ...(title ? { title } : {}) })),
};

export const SHARE_SHEET = new InjectionToken<ShareSheet>('SHARE_SHEET', {
  providedIn: 'root',
  factory: () => browserShareSheet,
});
