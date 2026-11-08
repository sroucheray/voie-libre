import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { LngLat } from '../core/map/map-factory';
import { NetworkStatus } from '../core/offline/network-status';
import {
  type FoundPlace,
  GeocodingService,
  type SearchErrorCode,
} from './geocoding.service';

/** Wait for the user to stop typing before searching. */
export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_QUERY_LENGTH = 2;

let nextId = 0;

/**
 * A text field that finds a place or an address: suggestions come from the API as the user types
 * and picking one emits it. When not edited it shows `label`. It is disabled offline, where the
 * search cannot work, and while `blocked` (no start yet for the end field).
 */
@Component({
  selector: 'vl-place-field',
  imports: [TranslocoPipe],
  templateUrl: './place-field.html',
  styleUrl: './place-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceField {
  readonly role = input.required<'start' | 'end'>();
  /** What to show when the user is not typing: the name or coordinates of the point. */
  readonly label = input<string | null>(null);
  /** Favours suggestions close to this position. */
  readonly near = input<LngLat | null>(null);
  readonly blocked = input(false);
  readonly picked = output<FoundPlace>();

  protected readonly network = inject(NetworkStatus);
  private readonly geocoding = inject(GeocodingService);

  private readonly id = `place-field-${nextId++}`;
  protected readonly inputId = `${this.id}-input`;
  protected readonly listId = `${this.id}-list`;

  /** What the user typed, or `null` while the field shows `label`. */
  protected readonly query = signal<string | null>(null);
  protected readonly shown = computed(() => this.query() ?? this.label() ?? '');
  protected readonly results = signal<FoundPlace[]>([]);
  protected readonly active = signal(-1);
  private readonly error = signal<SearchErrorCode | null>(null);
  /** The text an answer was received for, so "no result" is only said for a finished search. */
  private readonly answered = signal<string | null>(null);

  protected readonly open = computed(
    () => this.query() !== null && this.results().length > 0,
  );
  protected readonly disabled = computed(
    () => this.blocked() || !this.network.online(),
  );

  /** A translation key telling why there is nothing to pick, if there is something to tell. */
  protected readonly messageKey = computed(() => {
    if (!this.network.online()) return 'planner.search.offline';
    const error = this.error();
    if (error) return `planner.search.errors.${error}`;
    const query = this.query()?.trim();
    return query && this.answered() === query && this.results().length === 0
      ? 'planner.search.noResults'
      : null;
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  protected optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  protected onFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.query.set(text);
    this.active.set(-1);
    this.error.set(null);
    this.answered.set(null);
    this.results.set([]);
    this.cancel();
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    this.timer = setTimeout(
      () => void this.search(trimmed),
      SEARCH_DEBOUNCE_MS,
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        if (count === 0) return;
        event.preventDefault();
        this.active.update((i) => Math.min(i + 1, count - 1));
        break;
      case 'ArrowUp':
        if (count === 0) return;
        event.preventDefault();
        this.active.update((i) => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        // Enter on suggestions picks the highlighted one, or the first.
        const place = this.results()[Math.max(this.active(), 0)];
        if (!place) return;
        event.preventDefault();
        this.pick(place);
        break;
      }
      case 'Escape':
        if (this.query() === null) return;
        event.preventDefault();
        this.reset();
        break;
    }
  }

  protected pick(place: FoundPlace): void {
    this.reset();
    this.picked.emit(place);
  }

  /** Leaving the field drops what was typed: the field shows its point again. */
  protected reset(): void {
    this.cancel();
    this.query.set(null);
    this.results.set([]);
    this.active.set(-1);
    this.error.set(null);
    this.answered.set(null);
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private async search(text: string): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const result = await this.geocoding.search(
      text,
      controller.signal,
      this.near() ?? undefined,
    );
    if (!result || controller.signal.aborted) return;
    this.controller = null;
    this.answered.set(text);
    if ('error' in result) {
      this.error.set(result.error);
      this.results.set([]);
    } else {
      this.error.set(null);
      this.results.set(result.places);
    }
  }
}
