import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiStatus } from './core/api-status/api-status';
import { Planner } from './planner/planner';
import { LanguageSwitch } from './core/language-switch/language-switch';

@Component({
  imports: [RouterModule, TranslocoPipe, LanguageSwitch, ApiStatus, Planner],
  selector: 'vl-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
