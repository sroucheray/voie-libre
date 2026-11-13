import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ABOUT_LINKS } from '../about/about-config';
import { Icon } from '../icons/icon';
import { WelcomeScreen } from './welcome-screen';

/** The first screen: what the app does, that it is free, and the two ways to start. */
@Component({
  selector: 'vl-welcome',
  imports: [TranslocoPipe, Icon],
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Welcome {
  protected readonly screen = inject(WelcomeScreen);
  protected readonly links = inject(ABOUT_LINKS);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  constructor() {
    // The window takes the focus when it opens, so that Escape and the keyboard work in it.
    effect(() => {
      const box = this.box();
      if (box) box.nativeElement.focus();
    });
  }
}
