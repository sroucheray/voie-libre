import { Injectable, signal } from '@angular/core';
/** What the share dialog is about: the saved route a link is made from (a link needs a saved route). */
export interface ShareTarget {
  savedId: string;
}

/** Opens and closes the one share dialog of the planner, from any button that shares a route. */
@Injectable({ providedIn: 'root' })
export class ShareDialogService {
  readonly target = signal<ShareTarget | null>(null);
  /** Goes up each time a short link is made or removed, so lists can read the records again. */
  readonly changed = signal(0);

  open(target: ShareTarget): void {
    this.target.set(target);
  }

  close(): void {
    this.target.set(null);
  }

  notifyChanged(): void {
    this.changed.update((n) => n + 1);
  }
}
