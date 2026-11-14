import { DOCUMENT } from '@angular/common';
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
import { routeLinkUrl, type RouteLink } from './route-link';
import { SHARE_SHEET } from './share-sheet';

/** How long "Link copied" stays on screen. */
export const COPIED_VISIBLE_MS = 6000;

/**
 * "Copy the link" for a route: the link carries the points, the profile, the loop mode and the
 * name, and goes to the clipboard (it works on every browser, unlike the share sheet). Nothing is
 * sent to the server. The text that follows a copy says who can see the route.
 */
@Component({
  selector: 'vl-copy-link-button',
  imports: [TranslocoPipe],
  templateUrl: './copy-link-button.html',
  styleUrl: './copy-link-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyLinkButton implements OnDestroy {
  /** The route to link to; `null` when there is none yet (the button is then off). */
  readonly link = input.required<RouteLink | null>();
  /** Names the route for assistive technology (a list has one button per route). */
  readonly name = input<string | null>(null);

  private readonly document = inject(DOCUMENT);
  private readonly sheet = inject(SHARE_SHEET);
  /** The system share sheet is offered only where the browser has one (not Firefox desktop). */
  protected readonly canShare = this.sheet.canShareUrl();
  protected readonly state = signal<'idle' | 'copied' | 'failed'>('idle');
  protected readonly url = computed(() => {
    const link = this.link();
    const origin = this.document.defaultView?.location.origin;
    return link && origin ? routeLinkUrl(origin, link) : null;
  });
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

  protected select(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
