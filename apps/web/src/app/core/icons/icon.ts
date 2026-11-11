import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ICONS, type IconName, type IconShape } from './icons';

/**
 * An icon of the set in `icons.ts`, in the colour of the text around it. Its size is
 * `--icon-size` (1.25 rem by default); the icon is decorative: the button around it has the name.
 */
@Component({
  selector: 'vl-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    @for (d of shape().paths ?? []; track d) {
      <path [attr.d]="d" />
    }
    @for (dot of shape().dots ?? []; track dot[0] + ',' + dot[1]) {
      <circle [attr.cx]="dot[0]" [attr.cy]="dot[1]" r="1" />
    }
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      width: var(--icon-size, 1.25rem);
      height: var(--icon-size, 1.25rem);
      flex: none;
    }

    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly shape = computed<IconShape>(() => ICONS[this.name()]);
}
