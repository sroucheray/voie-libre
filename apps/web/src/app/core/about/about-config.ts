import { InjectionToken } from '@angular/core';

/** The links of the "About" window. */
export interface AboutLinks {
  /** The GitHub repository (the source code, the issues, the licence). */
  repository: string;
  /**
   * Where to send a donation (a Liberapay or GitHub Sponsors page), or `null` for none yet: the
   * "Support the project" part of the window then stays out. Only a link, opened by the visitor:
   * the app handles no payment and calls no service before the click.
   */
  donation: string | null;
}

export const ABOUT_LINKS = new InjectionToken<AboutLinks>('ABOUT_LINKS', {
  providedIn: 'root',
  factory: () => ({
    repository: 'https://github.com/sroucheray/voie-libre',
    donation: 'https://liberapay.com/sroucheray',
  }),
});
