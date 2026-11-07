import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
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
    provideAppInitializer(() => inject(LanguageService).init()),
  ],
};
