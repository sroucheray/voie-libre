import { Injectable, signal } from '@angular/core';
import type { RouteLink } from './route-link';

/** What the share dialog is about: the route as a link carries it, and its saved record if any. */
export interface ShareTarget {
  link: RouteLink;
  /** The saved route a short link can be made from (it needs the whole itinerary), or null. */
  savedId: string | null;
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
