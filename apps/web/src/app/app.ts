import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UpdatePrompt } from './core/offline/update-prompt';
import { OfflineMap } from './core/offline/offline-map';
import { ApiStatus } from './core/api-status/api-status';
import { Planner } from './planner/planner';
import { LanguageSwitch } from './core/language-switch/language-switch';
import { About } from './core/about/about';

@Component({
  imports: [
    RouterModule,
    TranslocoPipe,
    LanguageSwitch,
    About,
    ApiStatus,
    OfflineMap,
    UpdatePrompt,
    Planner,
  ],
  selector: 'vl-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
