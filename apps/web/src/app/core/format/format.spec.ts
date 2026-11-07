import {
  formatBytes,
  formatDate,
  formatDistance,
  formatDuration,
  formatElevation,
  formatNumber,
  languageName,
} from './format';

// Intl uses non-breaking and narrow spaces; normalise them so the expectations stay readable.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('formatDistance', () => {
  it('uses metres below one kilometre', () => {
    expect(plain(formatDistance(850.4, 'en'))).toBe('850 m');
  });

  it('uses kilometres with one decimal under 100 km', () => {
    expect(plain(formatDistance(12345, 'en'))).toBe('12.3 km');
  });

  it('drops the decimal from 100 km', () => {
    expect(plain(formatDistance(147800, 'en'))).toBe('148 km');
  });

  it('follows the locale decimal separator', () => {
    expect(plain(formatDistance(12345, 'fr'))).toBe('12,3 km');
  });
});

describe('formatElevation', () => {
  it('rounds to the metre', () => {
    expect(plain(formatElevation(398.6, 'en'))).toBe('399 m');
  });

  it('groups thousands per locale', () => {
    expect(plain(formatElevation(1942, 'en'))).toBe('1,942 m');
    expect(plain(formatElevation(1942, 'fr'))).toBe('1 942 m');
  });
});

describe('formatDuration', () => {
  it('shows hours and minutes', () => {
    expect(plain(formatDuration(8700, 'en'))).toBe('2 hr 25 min');
  });

  it('shows only minutes under an hour', () => {
    expect(plain(formatDuration(2700, 'en'))).toBe('45 min');
  });

  it('keeps a zero minute part after full hours', () => {
    expect(plain(formatDuration(7200, 'en'))).toBe('2 hr 0 min');
  });

  it('never goes negative', () => {
    expect(plain(formatDuration(-30, 'en'))).toBe('0 min');
  });

  it('localises the unit names', () => {
    expect(plain(formatDuration(8700, 'fr'))).toBe('2 h 25 min');
  });
});

describe('formatNumber', () => {
  it('uses the locale separators', () => {
    expect(plain(formatNumber(1234.5, 'en'))).toBe('1,234.5');
    expect(plain(formatNumber(1234.5, 'fr'))).toBe('1 234,5');
  });
});

describe('formatDate', () => {
  const date = new Date(Date.UTC(2026, 10, 7, 12));

  it('formats a medium date per locale', () => {
    expect(
      plain(formatDate(date, 'en', { dateStyle: 'medium', timeZone: 'UTC' })),
    ).toBe('Nov 7, 2026');
    expect(
      plain(formatDate(date, 'fr', { dateStyle: 'medium', timeZone: 'UTC' })),
    ).toBe('7 nov. 2026');
  });

  it('accepts timestamps and ISO strings', () => {
    const options = { dateStyle: 'medium', timeZone: 'UTC' } as const;
    expect(formatDate(date.getTime(), 'en', options)).toBe(
      formatDate(date.toISOString(), 'en', options),
    );
  });
});

describe('languageName', () => {
  it('writes each language in itself', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('fr')).toBe('français');
  });
});

describe('formatBytes', () => {
  it('uses megabytes with one decimal', () => {
    expect(plain(formatBytes(42_680_958, 'en'))).toBe('42.7 MB');
    expect(plain(formatBytes(42_680_958, 'fr'))).toBe('42,7 Mo');
  });

  it('switches to gigabytes from 1 GB', () => {
    expect(plain(formatBytes(1_500_000_000, 'en'))).toBe('1.5 GB');
  });
});
