import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Profile } from './planner-store';

let nextId = 0;

/**
 * The choice of the routing profile: one button with a pictogram per sport (a road bike, a gravel
 * bike, a runner) and the description of the selected one under them. It is a radio group: one
 * button is in the tab order, the arrows move the choice, Home and End go to the ends.
 */
@Component({
  selector: 'vl-profile-select',
  imports: [TranslocoPipe],
  templateUrl: './profile-select.html',
  styleUrl: './profile-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileSelect {
  readonly value = input.required<Profile>();
  readonly profiles = input.required<readonly Profile[]>();
  readonly changed = output<Profile>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly id = `profile-select-${nextId++}`;
  protected readonly labelId = `${this.id}-label`;
  protected readonly descriptionId = `${this.id}-description`;

  protected pick(profile: Profile): void {
    if (profile !== this.value()) this.changed.emit(profile);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const profiles = this.profiles();
    const current = Math.max(profiles.indexOf(this.value()), 0);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = Math.min(current + 1, profiles.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = Math.max(current - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = profiles.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.pick(profiles[next]);
    // The new choice is the one in the tab order: the focus follows it once it is drawn.
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelectorAll<HTMLElement>('[role=radio]')
        [next]?.focus(),
    );
  }
}
