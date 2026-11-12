import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon } from '../icons/icon';
import { ABOUT_LINKS } from './about-config';

/** The "i" button of the header and the window it opens: what the app is, its code, credits, support. */
@Component({
  selector: 'vl-about',
  imports: [TranslocoPipe, Icon],
  templateUrl: './about.html',
  styleUrl: './about.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class About {
  protected readonly links = inject(ABOUT_LINKS);
  protected readonly open = signal(false);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  constructor() {
    // The window takes the focus when it opens, so that Escape and the keyboard work in it.
    effect(() => {
      const box = this.box();
      if (box) box.nativeElement.focus();
    });
  }

  protected show(): void {
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }
}
