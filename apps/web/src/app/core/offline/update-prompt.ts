import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppUpdate } from './app-update';

/** A bar offering to reload into the new version of the app. Never reloads by itself. */
@Component({
  selector: 'vl-update-prompt',
  imports: [TranslocoPipe],
  templateUrl: './update-prompt.html',
  styleUrl: './update-prompt.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdatePrompt {
  protected readonly update = inject(AppUpdate);
}
