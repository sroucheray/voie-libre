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
import { ShareDialogService } from './share-dialog.service';
import {
  LIFETIMES,
  ShareError,
  ShareService,
  activeShare,
  type Lifetime,
  type ShareErrorCode,
} from './share.service';

/**
 * The dialog behind every "Share" button: a link to a copy of a saved route, kept on the server for
 * a day, a week or a month, then removed. It says what is stored, where and until when; nothing is
 * sent to the server until "Create the link" is pressed. The buttons that carry the link (QR code,
 * copy, system share sheet) come once the link exists.
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

  protected readonly lifetimes = LIFETIMES;
  protected readonly lifetime = signal<Lifetime>('week');
  protected readonly busy = signal(false);
  protected readonly error = signal<ShareErrorCode | 'storage' | null>(null);
  /** The saved route a short link is made from, read when the dialog opens. */
  protected readonly saved = signal<SavedRoute | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly target = this.dialogs.target;
  protected readonly name = computed(() => this.saved()?.name ?? null);

  /** The short link and when it stops working, while the copy is still on the server. */
  protected readonly share = computed(() => {
    const saved = this.saved();
    return saved ? activeShare(saved) : null;
  });
  protected readonly url = computed(() => {
    const saved = this.saved();
    return saved && this.share() ? this.sharing.linkFor(saved.id) : null;
  });

  /** Why a link cannot be made (a route imported without elevation), or null when it can. */
  protected readonly blocked = computed(() => {
    const saved = this.saved();
    return saved && saved.ascentMeters === null ? 'sharing.needsClimb' : null;
  });

  constructor() {
    effect(() => {
      const target = this.target();
      const dialog = this.dialog()?.nativeElement;
      if (!target || !dialog) return;
      untracked(() => {
        this.error.set(null);
        this.saved.set(null);
        if (!dialog.open) {
          // jsdom has no showModal: the dialog still opens, only without its backdrop.
          if (typeof dialog.showModal === 'function') dialog.showModal();
          else dialog.setAttribute('open', '');
        }
        void this.load(target.savedId);
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
}
