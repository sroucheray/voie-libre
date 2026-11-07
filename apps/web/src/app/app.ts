import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageSwitch } from './core/language-switch/language-switch';

@Component({
  imports: [RouterModule, TranslocoPipe, LanguageSwitch],
  selector: 'vl-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
