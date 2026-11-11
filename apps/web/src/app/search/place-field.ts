import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { LngLat } from '../core/map/map-factory';
import { LocationStore } from '../location/location-store';
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
 * search cannot work, and while `blocked` (no start yet for the end field). A stop shows its
 * `number` in place of the letter of the start and the end. An empty field that has the focus
 * offers the user's position as its first choice (`position`), when the device can give one.
 */
@Component({
  selector: 'vl-place-field',
  imports: [TranslocoPipe],
  templateUrl: './place-field.html',
  styleUrl: './place-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.bare]': 'bareMarker()' },
})
export class PlaceField {
  readonly role = input.required<'start' | 'end' | 'stop'>();
  /** Which stop this is, counted from 1; unused for the start and the end. */
  readonly number = input<number | null>(null);
  /** What to show when the user is not typing: the name or coordinates of the point. */
  readonly label = input<string | null>(null);
  /** Favours suggestions close to this position. */
  readonly near = input<LngLat | null>(null);
  readonly blocked = input(false);
  /** Leaves the marker out: the row around the field shows it (a stop's reorder handle). */
  readonly bareMarker = input(false);
  readonly picked = output<FoundPlace>();
  /** The user asked for their own position here; the field itself never reads it. */
  readonly position = output<void>();

  private readonly field =
    viewChild.required<ElementRef<HTMLInputElement>>('field');
  protected readonly marker = computed(() => {
    const role = this.role();
    return role === 'start'
      ? 'A'
      : role === 'end'
        ? 'B'
        : `${this.number() ?? ''}`;
  });

  protected readonly network = inject(NetworkStatus);
  private readonly geocoding = inject(GeocodingService);
  private readonly location = inject(LocationStore);

  private readonly id = `place-field-${nextId++}`;
  protected readonly inputId = `${this.id}-input`;
  protected readonly listId = `${this.id}-list`;

  /** What the user typed, or `null` while the field shows `label`. */
  protected readonly query = signal<string | null>(null);
  protected readonly shown = computed(() => this.query() ?? this.label() ?? '');
  protected readonly results = signal<FoundPlace[]>([]);
  protected readonly active = signal(-1);
  /** A search is pending (typing paused, request on its way): the field shows a small spinner. */
  protected readonly searching = signal(false);
  private readonly error = signal<SearchErrorCode | null>(null);
  /** The text an answer was received for, so "no result" is only said for a finished search. */
  private readonly answered = signal<string | null>(null);

  private readonly focused = signal(false);
  /** "My position" is the only choice of an empty field: there is nothing else to suggest. */
  protected readonly offersPosition = computed(
    () =>
      this.focused() && this.shown().trim() === '' && this.location.available(),
  );
  protected readonly open = computed(
    () =>
      this.offersPosition() ||
      (this.query() !== null && this.results().length > 0),
  );
  protected readonly disabled = computed(
    () => this.blocked() || !this.network.online(),
  );

  /** A translation key telling why there is nothing to pick, if there is something to tell. */
  protected readonly messageKey = computed(() => {
    // Said once by the start and the end, not by every stop.
    if (!this.network.online())
      return this.role() === 'stop' ? null : 'planner.search.offline';
    const error = this.error();
    if (error) return `planner.search.errors.${error}`;
    const query = this.query()?.trim();
    return query && this.answered() === query && this.results().length === 0
      ? 'planner.search.noResults'
      : null;
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  /**
   * Where the list of suggestions is drawn, in the window's coordinates: it floats over the page
   * (`position: fixed`) so that neither the scrolling panel clips it nor does it push the fields
   * below it down. Followed while the list is open.
   */
  protected readonly box = signal<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
    effect((onCleanup) => {
      if (!this.open()) {
        this.box.set(null);
        return;
      }
      const place = () => {
        const rect = this.field().nativeElement.getBoundingClientRect();
        this.box.set({
          left: rect.left,
          top: rect.bottom + 2,
          width: rect.width,
        });
      };
      place();
      // Scroll events do not bubble: capture them to follow the panel's own scrolling too.
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      onCleanup(() => {
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
      });
    });
  }

  /** Puts the keyboard in the field, e.g. when it was just added. */
  focus(): void {
    this.field().nativeElement.focus();
  }

  protected optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  protected onFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
    this.focused.set(true);
  }

  protected onBlur(): void {
    this.focused.set(false);
    this.reset();
  }

  protected pickPosition(): void {
    this.reset();
    // Without this the empty field would offer the position again at once.
    this.field().nativeElement.blur();
    this.focused.set(false);
    this.position.emit();
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
    this.searching.set(false);
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    this.searching.set(true);
    this.timer = setTimeout(
      () => void this.search(trimmed),
      SEARCH_DEBOUNCE_MS,
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    const position = this.offersPosition();
    const count = position ? 1 : this.results().length;
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
        if (position) {
          event.preventDefault();
          this.pickPosition();
          return;
        }
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
    this.searching.set(false);
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
    this.searching.set(false);
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
