import type { Profile } from './planner-store';

/** Default speeds in km/h by profile: what a loop asked by duration assumes until the user changes it. */
export const DEFAULT_SPEEDS_KMH: Record<Profile, number> = {
  road: 22,
  gravel: 17,
  trail: 8,
};

export const SPEED_MIN_KMH = 3;
export const SPEED_MAX_KMH = 60;

/** The speed kept when it is out of range or not a number: the default of the profile. */
export function sanitizeSpeed(value: unknown, profile: Profile): number {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0
    ? Math.min(SPEED_MAX_KMH, Math.max(SPEED_MIN_KMH, speed))
    : DEFAULT_SPEEDS_KMH[profile];
}

/** The distance in meters covered in `minutes` at `speedKmh` (climb ignored). */
export function distanceFor(minutes: number, speedKmh: number): number {
  return Math.round((minutes / 60) * speedKmh * 1000);
}

/** The time in seconds to cover `meters` at `speedKmh` (climb ignored). */
export function durationFor(meters: number, speedKmh: number): number {
  return Math.round((meters / 1000 / speedKmh) * 3600);
}
