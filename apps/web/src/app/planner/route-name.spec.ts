import type { LngLat } from '../core/map/map-factory';
import { autoRouteName } from './route-name';

const A: LngLat = [3.087, 45.777];
const B: LngLat = [3.249, 45.544];
const S: LngLat = [3.4, 45.7];
const T: LngLat = [3.5, 45.6];

const names = (known: Record<string, string>) => (p: LngLat) =>
  known[`${p[0]},${p[1]}`] ?? null;

const known = names({
  [`${A}`]: 'Clermont-Ferrand',
  [`${B}`]: 'Issoire',
  [`${S}`]: 'Thiers',
  [`${T}`]: 'Ambert',
});

describe('autoRouteName', () => {
  it('names a trip after its two ends', () => {
    expect(autoRouteName([A, B], known)).toEqual({
      key: 'saved.autoName.trip',
      params: { from: 'Clermont-Ferrand', to: 'Issoire' },
    });
  });

  it('adds the stop when there is one and it is named, and counts them when there are more', () => {
    expect(autoRouteName([A, S, B], known)).toEqual({
      key: 'saved.autoName.tripVia',
      params: { from: 'Clermont-Ferrand', to: 'Issoire', via: 'Thiers' },
    });
    expect(autoRouteName([A, S, T, B], known)).toEqual({
      key: 'saved.autoName.tripStops',
      params: { from: 'Clermont-Ferrand', to: 'Issoire', count: 2 },
    });
  });

  it('leaves a stop out when it has no name', () => {
    const noStop = names({ [`${A}`]: 'Clermont-Ferrand', [`${B}`]: 'Issoire' });
    expect(autoRouteName([A, S, B], noStop)).toEqual({
      key: 'saved.autoName.trip',
      params: { from: 'Clermont-Ferrand', to: 'Issoire' },
    });
  });

  it('names a loop after its start, with or without stops', () => {
    expect(autoRouteName([A, A], known)).toEqual({
      key: 'saved.autoName.loop',
      params: { place: 'Clermont-Ferrand' },
    });
    expect(autoRouteName([A, S, B, A], known)).toEqual({
      key: 'saved.autoName.loop',
      params: { place: 'Clermont-Ferrand' },
    });
  });

  it('says "around" when both ends are in the same place but are not the same point', () => {
    const sameTown = names({ [`${A}`]: 'Issoire', [`${B}`]: 'Issoire' });
    expect(autoRouteName([A, B], sameTown)).toEqual({
      key: 'saved.autoName.within',
      params: { place: 'Issoire' },
    });
  });

  it('proposes nothing when an end has no name, or there is no route yet', () => {
    expect(
      autoRouteName([A, B], names({ [`${A}`]: 'Clermont-Ferrand' })),
    ).toBeNull();
    expect(autoRouteName([A, B], names({ [`${B}`]: 'Issoire' }))).toBeNull();
    expect(autoRouteName([A], known)).toBeNull();
    expect(autoRouteName([], known)).toBeNull();
    expect(autoRouteName([A, A], names({}))).toBeNull();
  });
});
