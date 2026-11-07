import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { languageName } from '../format/format';
import { LanguageService } from '../i18n/language.service';
import { Language, isSupportedLanguage } from '../i18n/languages';

@Component({
  selector: 'vl-language-switch',
  imports: [TranslocoPipe],
  templateUrl: './language-switch.html',
})
export class LanguageSwitch {
  protected readonly languages = inject(LanguageService);
  protected readonly name = languageName;

  protected select(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (isSupportedLanguage(value)) {
      this.languages.use(value as Language);
    }
  }
}
