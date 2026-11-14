import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { PwaInstall } from './core/pwa/pwa-install';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTransloco } from '@jsverse/transloco';
import { appRoutes } from './app.routes';
import { LanguageService } from './core/i18n/language.service';
import { createTranslocoConfig } from './core/i18n/transloco-config';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(withFetch()),
    provideTransloco({
      config: createTranslocoConfig(!isDevMode()),
      loader: TranslocoHttpLoader,
    }),
    // Offline shell. Disabled in development: a service worker caches files and hides changes.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(() => inject(LanguageService).init()),
    // Listens from the start: the browser can say "installable" long before the About window opens.
    provideAppInitializer(() => void inject(PwaInstall)),
  ],
};
