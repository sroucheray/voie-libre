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
import { AboutScreen } from '../about/about-screen';
import { ABOUT_LINKS } from '../about/about-config';
import { HealthService } from '../api/health.service';
import { languageName } from '../format/format';
import { LanguageService } from '../i18n/language.service';
import { Icon } from '../icons/icon';
import { OfflineMap } from '../offline/offline-map';

/**
 * A phone has no header: the logo floats over the map, and this menu holds what the header held
 * (language, support, "About") and the offline actions. A small dot on the logo warns when the
 * server cannot be reached.
 */
@Component({
  selector: 'vl-phone-menu',
  imports: [TranslocoPipe, Icon, OfflineMap],
  templateUrl: './phone-menu.html',
  styleUrl: './phone-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneMenu {
  protected readonly languages = inject(LanguageService);
  protected readonly health = inject(HealthService);
  protected readonly links = inject(ABOUT_LINKS);
  private readonly about = inject(AboutScreen);
  protected readonly name = languageName;
  protected readonly open = signal(false);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  constructor() {
    // The menu takes the focus when it opens, so that Escape works in it.
    effect(() => {
      const box = this.box();
      if (box) box.nativeElement.focus();
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected showAbout(): void {
    this.open.set(false);
    this.about.show();
  }
}
