import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UpdatePrompt } from './core/offline/update-prompt';
import { OfflineMap } from './core/offline/offline-map';
import { ApiStatus } from './core/api-status/api-status';
import { Planner } from './planner/planner';
import { LanguageSwitch } from './core/language-switch/language-switch';
import { About } from './core/about/about';
import { ABOUT_LINKS } from './core/about/about-config';
import { Icon } from './core/icons/icon';
import { FullscreenMap } from './core/fullscreen/fullscreen-map';
import { PhoneMenu } from './core/phone-menu/phone-menu';
import { Welcome } from './core/welcome/welcome';

@Component({
  imports: [
    RouterModule,
    TranslocoPipe,
    LanguageSwitch,
    About,
    Icon,
    Welcome,
    PhoneMenu,
    ApiStatus,
    OfflineMap,
    UpdatePrompt,
    Planner,
  ],
  selector: 'vl-root',
  host: { '[class.map-fullscreen]': 'fullscreen.active()' },
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly fullscreen = inject(FullscreenMap);
  /** The donation link of the header, from the same place as the About window. */
  protected readonly donation = inject(ABOUT_LINKS).donation;
}
