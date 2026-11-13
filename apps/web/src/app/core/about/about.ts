import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon } from '../icons/icon';
import { ABOUT_LINKS } from './about-config';
import { AboutScreen } from './about-screen';
import { WelcomeScreen } from '../welcome/welcome-screen';
import { APP_VERSION } from './version';

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
  protected readonly version = APP_VERSION;
  private readonly welcome = inject(WelcomeScreen);
  protected readonly screen = inject(AboutScreen);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  constructor() {
    // The window takes the focus when it opens, so that Escape and the keyboard work in it.
    effect(() => {
      const box = this.box();
      if (box) box.nativeElement.focus();
    });
  }

  protected showWelcome(): void {
    this.screen.close();
    this.welcome.show();
  }
}
