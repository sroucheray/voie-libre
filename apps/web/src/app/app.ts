import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiStatus } from './core/api-status/api-status';
import { MapView } from './core/map/map-view';
import { LanguageSwitch } from './core/language-switch/language-switch';

@Component({
  imports: [RouterModule, TranslocoPipe, LanguageSwitch, ApiStatus, MapView],
  selector: 'vl-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
