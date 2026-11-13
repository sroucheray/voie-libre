import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormattingService } from '../core/format/formatting.service';
import {
  PROFILE_HEIGHT,
  PROFILE_WIDTH,
  buildProfile,
  profilePaths,
  stretchStats,
} from './elevation-profile';
import { DescentColours } from './descent-colours';
import { PlannerStore } from './planner-store';

/**
 * A light elevation profile for the open sheet of a phone: the coloured curve, small, and one line of
 * figures (distance, ascent, descent). No cursor, selection, legend or surface: the full profile
 * under the map keeps those.
 */
@Component({
  selector: 'vl-profile-mini',
  imports: [TranslocoPipe],
  templateUrl: './profile-mini.html',
  styleUrl: './profile-mini.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileMini {
  protected readonly store = inject(PlannerStore);
  protected readonly format = inject(FormattingService);
  private readonly descents = inject(DescentColours);
  /** Only the curve, without the line of figures: for the header of the folded profile strip. */
  readonly compact = input(false, { transform: booleanAttribute });
  protected readonly viewBox = `0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`;

  private readonly profile = computed(() =>
    this.store.elevationKnown()
      ? buildProfile(this.store.selectedGeometry())
      : null,
  );

  protected readonly view = computed(() => {
    const profile = this.profile();
    if (!profile) return null;
    const totals = stretchStats(profile, 0, profile.samples.length - 1);
    return {
      paths: profilePaths(
        profile,
        this.descents.coloured(this.store.profile()),
      ),
      distance: profile.totalDistance,
      ascent: totals.ascent,
      descent: totals.descent,
    };
  });
}
