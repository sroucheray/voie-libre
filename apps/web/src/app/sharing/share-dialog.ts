import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormattingService } from '../core/format/formatting.service';
import { ROUTE_STORE } from '../storage/route-store';
import type { SavedRoute } from '../storage/saved-route';
import { LinkActions } from './link-actions';
import { routeLinkUrl } from './route-link';
import { ShareDialogService } from './share-dialog.service';
import {
  LIFETIMES,
  ShareError,
  ShareService,
  activeShare,
  type Lifetime,
  type ShareErrorCode,
} from './share.service';

/** The two kinds of link the dialog offers. */
export type LinkKind = 'contained' | 'short';

/**
 * The dialog behind every "Share" button. The choice of link comes first (the route written in the
 * link, or a short link whose copy the server keeps for a day, a week or a month), the buttons that
 * carry the link come after, and each choice says what is stored, where and for how long. Nothing
 * is sent to the server until "Create the short link" is pressed.
 */
@Component({
  selector: 'vl-share-dialog',
  imports: [TranslocoPipe, LinkActions],
  templateUrl: './share-dialog.html',
  styleUrl: './share-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareDialog {
  protected readonly dialogs = inject(ShareDialogService);
  protected readonly format = inject(FormattingService);
  private readonly sharing = inject(ShareService);
  private readonly routeStore = inject(ROUTE_STORE);
  private readonly document = inject(DOCUMENT);

  protected readonly lifetimes = LIFETIMES;
  protected readonly kind = signal<LinkKind>('contained');
  protected readonly lifetime = signal<Lifetime>('week');
  protected readonly busy = signal(false);
  protected readonly error = signal<ShareErrorCode | 'storage' | null>(null);
  /** The saved route a short link is made from, read when the dialog opens. */
  private readonly saved = signal<SavedRoute | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly target = this.dialogs.target;
  protected readonly name = computed(() => this.target()?.link.name ?? null);

  /**
   * A loop by distance whose chosen alternative is not known (a saved one): opened from the link
   * it may come out another way, which the short link, with its exact track, does not.
   */
  protected readonly loopMayDiffer = computed(() => {
    const link = this.target()?.link;
    return link?.loop?.mode === 'distance' && !link.alternative;
  });

  protected readonly containedUrl = computed(() => {
    const link = this.target()?.link;
    const origin = this.document.defaultView?.location.origin;
    return link && origin ? routeLinkUrl(origin, link) : null;
  });

  /** The short link and when it stops working, while the copy is still on the server. */
  protected readonly share = computed(() => {
    const saved = this.saved();
    return saved ? activeShare(saved) : null;
  });
  protected readonly shortUrl = computed(() => {
    const saved = this.saved();
    return saved && this.share() ? this.sharing.linkFor(saved.id) : null;
  });

  /** Why a short link cannot be made, as a translation key, or null when it can. */
  protected readonly shortBlocked = computed(() => {
    if (!this.target()?.savedId) return 'sharing.dialog.needsSave';
    const saved = this.saved();
    if (saved && saved.ascentMeters === null) return 'sharing.needsClimb';
    return null;
  });

  protected readonly url = computed(() =>
    this.kind() === 'short' ? this.shortUrl() : this.containedUrl(),
  );

  constructor() {
    effect(() => {
      const target = this.target();
      const dialog = this.dialog()?.nativeElement;
      if (!target || !dialog) return;
      untracked(() => {
        this.kind.set('contained');
        this.error.set(null);
        this.saved.set(null);
        if (!dialog.open) {
          // jsdom has no showModal: the dialog still opens, only without its backdrop.
          if (typeof dialog.showModal === 'function') dialog.showModal();
          else dialog.setAttribute('open', '');
        }
        if (target.savedId) void this.load(target.savedId);
      });
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.saved.set((await this.routeStore.get(id)) ?? null);
    } catch {
      this.saved.set(null);
    }
  }

  protected choose(kind: LinkKind): void {
    if (kind === 'short' && this.shortBlocked()) return;
    this.kind.set(kind);
    this.error.set(null);
  }

  /** Makes the copy on the server, then keeps its delete token and date on the device. */
  protected async create(): Promise<void> {
    const saved = this.saved();
    if (!saved || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const info = await this.sharing.share(saved, this.lifetime());
      this.saved.set(await this.routeStore.setShare(saved.id, info));
      this.dialogs.notifyChanged();
    } catch (error) {
      this.error.set(error instanceof ShareError ? error.code : 'unknown');
    } finally {
      this.busy.set(false);
    }
  }

  /** Removes the copy from the server before its time is up. */
  protected async deleteCopy(): Promise<void> {
    const saved = this.saved();
    if (!saved || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.sharing.unshare(saved);
      this.saved.set(await this.routeStore.setShare(saved.id, null));
      this.dialogs.notifyChanged();
    } catch (error) {
      this.error.set(error instanceof ShareError ? error.code : 'unknown');
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    this.dialogs.close();
  }

  /** A click on the backdrop (the dialog element itself, outside its content) closes it. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog()?.nativeElement) this.close();
  }

  protected radioKey(event: KeyboardEvent): void {
    // Arrow keys move through the choices, as in any radio group.
    if (
      !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    this.choose(this.kind() === 'contained' ? 'short' : 'contained');
  }
}
