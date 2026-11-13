import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { LanguageService } from '../core/i18n/language.service';
import { ProfileMini } from './profile-mini';
import { PlannerStore } from './planner-store';

describe('ProfileMini', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideTestTransloco()] });
    TestBed.inject(LanguageService).use('en');
    const store = TestBed.inject(PlannerStore);
    const fixture = TestBed.createComponent(ProfileMini);
    return { store, fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('shows nothing without a route', async () => {
    const { fixture, root } = setup();
    await fixture.whenStable();
    expect(root.querySelector('.mini')).toBeNull();
  });

  it('shows the curve and one line of figures for the selected route', async () => {
    const { store, fixture, root } = setup();
    store.setRoutes([
      {
        geometry: [
          [3, 45, 400],
          [3.01, 45, 500],
          [3.02, 45, 450],
        ],
        distanceMeters: 1600,
        durationSeconds: 400,
        ascentMeters: 100,
      },
    ]);
    await fixture.whenStable();
    expect(root.querySelector('.mini svg path.line')).not.toBeNull();
    const text = root.querySelector('.mini p')?.textContent ?? '';
    expect(text).toMatch(/km|m/);
    expect(text).toContain('up');
    expect(text).toContain('down');
    // The full profile's cursor, selection and legend stay out of the light one.
    expect(root.querySelector('.cursor, .legend, .stretch, button')).toBeNull();
  });
});
