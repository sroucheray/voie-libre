import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * A pop-up: a native `<dialog>` opened as a modal while `open` is true, with a title, a close
 * button, and its content projected. Escape, the cross and a click on the backdrop all ask to
 * close (`closed`): the parent decides, by turning `open` off.
 */
@Component({
  selector: 'vl-modal',
  imports: [TranslocoPipe],
  template: `
    <!-- A click on the backdrop is a pointer shortcut: Escape and the cross serve the keyboard. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="modal"
      [attr.aria-label]="heading()"
      (cancel)="$event.preventDefault(); closed.emit()"
      (click)="onBackdrop($event)"
    >
      <div class="content">
        <header>
          <h2>{{ heading() }}</h2>
          <button
            type="button"
            class="close"
            [attr.aria-label]="'modal.close' | transloco"
            (click)="closed.emit()"
          >
            ×
          </button>
        </header>
        <ng-content />
      </div>
    </dialog>
  `,
  styleUrl: './modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Modal {
  readonly open = input.required<boolean>();
  /** The title, already translated. */
  readonly heading = input.required<string>();
  readonly closed = output<void>();

  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open()) {
        if (dialog.open) return;
        // jsdom has no showModal: the dialog still opens, only without its backdrop.
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } else if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.closed.emit();
  }
}
