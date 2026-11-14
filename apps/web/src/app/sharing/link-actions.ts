import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { encodeQr, qrSvgPath } from './qr-code';
import { SHARE_SHEET } from './share-sheet';

/** The biggest QR code offered: a denser one is hard to scan from a screen. */
export const QR_MAX_VERSION = 15;
/** Modules of white around the code, as the standard asks. */
const QR_BORDER = 4;

/** How long "Link copied" stays on screen. */
export const COPIED_VISIBLE_MS = 6000;

/**
 * What to do with a link: copy it (the clipboard works on every browser, unlike the share sheet),
 * hand it to the system share sheet where there is one, or show it as a QR code. Nothing is sent
 * anywhere by these buttons: they only carry the address they are given.
 */
@Component({
  selector: 'vl-link-actions',
  imports: [TranslocoPipe],
  templateUrl: './link-actions.html',
  styleUrl: './link-actions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkActions implements OnDestroy {
  /** The address to carry; `null` when there is none yet (the buttons are then off). */
  readonly url = input.required<string | null>();
  /** Names the route for assistive technology and gives the share sheet a title. */
  readonly name = input<string | null>(null);

  private readonly sheet = inject(SHARE_SHEET);
  /** The system share sheet is offered only where the browser has one (not Firefox desktop). */
  protected readonly canShare = this.sheet.canShareUrl();
  protected readonly state = signal<'idle' | 'copied' | 'failed'>('idle');
  /** The QR code of the link, or `null` when it is too long to scan from a screen. */
  protected readonly qr = computed(() => {
    const url = this.url();
    const code = url ? encodeQr(url, QR_MAX_VERSION) : null;
    return code
      ? {
          viewBox: `0 0 ${code.size + QR_BORDER * 2} ${code.size + QR_BORDER * 2}`,
          path: qrSvgPath(code, QR_BORDER),
        }
      : null;
  });
  protected readonly qrShown = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected async copy(): Promise<void> {
    const url = this.url();
    if (!url) return;
    let state: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // No clipboard access (insecure page, denied): the link is shown to be selected by hand.
      state = 'failed';
    }
    this.state.set(state);
    if (this.timer) clearTimeout(this.timer);
    this.timer =
      state === 'copied'
        ? setTimeout(() => this.state.set('idle'), COPIED_VISIBLE_MS)
        : null;
  }

  /** Hands the link to the system share sheet; closing the sheet is not an error. */
  protected async share(): Promise<void> {
    const url = this.url();
    if (!url) return;
    const outcome = await this.sheet.shareUrl({
      ...(this.name() ? { title: this.name() as string } : {}),
      url,
    });
    this.state.set(outcome === 'failed' ? 'failed' : 'idle');
  }

  protected toggleQr(): void {
    this.qrShown.update((shown) => !shown);
  }

  protected select(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
