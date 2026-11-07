/**
 * Locale-aware formatting of numbers, distances, durations and dates, built on `Intl`.
 * Pure functions: the locale is always passed in. Units are metric for now; a miles
 * option can be added later by threading a unit system through these functions.
 */

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Distance in metres: `850 m` below 1 km, otherwise kilometres (`12.3 km`, 1 decimal under 100 km). */
export function formatDistance(meters: number, locale: string): string {
  if (Math.abs(meters) < 1000) {
    return unit(Math.round(meters), 'meter', locale);
  }
  const km = meters / 1000;
  return unit(km, 'kilometer', locale, {
    maximumFractionDigits: Math.abs(km) < 100 ? 1 : 0,
  });
}

/** Elevation gain or loss in metres, rounded to the metre. */
export function formatElevation(meters: number, locale: string): string {
  return unit(Math.round(meters), 'meter', locale);
}

/** Duration in seconds as hours and minutes (`2 h 25 min`); under one hour only minutes. */
export function formatDuration(seconds: number, locale: string): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const minutesText = unit(minutes, 'minute', locale);
  return hours === 0
    ? minutesText
    : `${unit(hours, 'hour', locale)} ${minutesText}`;
}

export function formatDate(
  value: Date | number | string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

/** Name of a language written in that language itself (`English`, `français`). */
export function languageName(language: string): string {
  return (
    new Intl.DisplayNames([language], { type: 'language' }).of(language) ??
    language
  );
}

function unit(
  value: number,
  unitName: 'meter' | 'kilometer' | 'minute' | 'hour',
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: unitName,
    unitDisplay: 'short',
    ...options,
  }).format(value);
}
