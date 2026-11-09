import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Profile } from './planner-store';

let nextId = 0;

/**
 * The choice of the routing profile: a dropdown where each profile has a title and a short
 * description, which a native select cannot show. It behaves like a select: the focus stays on
 * the button, the arrows move in the list, Enter or Space picks, Escape closes without a change.
 */
@Component({
  selector: 'vl-profile-select',
  imports: [TranslocoPipe],
  templateUrl: './profile-select.html',
  styleUrl: './profile-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)' },
})
export class ProfileSelect {
  readonly value = input.required<Profile>();
  readonly profiles = input.required<readonly Profile[]>();
  readonly changed = output<Profile>();

  protected readonly open = signal(false);
  /** The option the keys are on while the list is open. */
  protected readonly active = signal(0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly id = `profile-select-${nextId++}`;
  protected readonly labelId = `${this.id}-label`;
  protected readonly valueId = `${this.id}-value`;
  protected readonly listId = `${this.id}-list`;

  protected optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  protected toggle(): void {
    if (this.open()) this.open.set(false);
    else this.show();
  }

  protected close(): void {
    this.open.set(false);
  }

  protected pick(profile: Profile): void {
    this.open.set(false);
    if (profile !== this.value()) this.changed.emit(profile);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const last = this.profiles().length - 1;
    if (!this.open()) {
      if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      this.show();
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        this.active.update((index) => Math.min(index + 1, last));
        break;
      case 'ArrowUp':
        this.active.update((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        this.active.set(0);
        break;
      case 'End':
        this.active.set(last);
        break;
      case 'Enter':
      case ' ':
        this.pick(this.profiles()[this.active()]);
        break;
      case 'Escape':
        this.open.set(false);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** A button is clicked when Space is released: the key was already handled when pressed. */
  protected onKeyup(event: KeyboardEvent): void {
    if (event.key === ' ') event.preventDefault();
  }

  protected onOutside(event: Event): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node | null))
      this.open.set(false);
  }

  private show(): void {
    this.active.set(Math.max(this.profiles().indexOf(this.value()), 0));
    this.open.set(true);
  }
}
