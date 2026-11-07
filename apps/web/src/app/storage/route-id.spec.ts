import { ROUTE_ID_ALPHABET, ROUTE_ID_LENGTH, createRouteId } from './route-id';

describe('createRouteId', () => {
  it('has 10 characters by default, within the 8 to 10 of the data model', () => {
    expect(ROUTE_ID_LENGTH).toBeGreaterThanOrEqual(8);
    expect(ROUTE_ID_LENGTH).toBeLessThanOrEqual(10);
    expect(createRouteId()).toHaveLength(ROUTE_ID_LENGTH);
  });

  it('uses only the alphabet, which has no ambiguous character', () => {
    expect(ROUTE_ID_ALPHABET).toHaveLength(32);
    expect(new Set(ROUTE_ID_ALPHABET).size).toBe(32);
    expect(ROUTE_ID_ALPHABET).not.toMatch(/[01lIO]/);
    for (let i = 0; i < 2000; i++) {
      expect(createRouteId()).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]+$/);
    }
  });

  it('draws every character of the alphabet, without bias towards a few', () => {
    const counts = new Map<string, number>();
    const draws = 3200;
    for (let i = 0; i < draws; i++) {
      for (const char of createRouteId()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(32);
    const expected = (draws * ROUTE_ID_LENGTH) / 32;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });

  it('does not collide on a large draw', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100_000; i++) ids.add(createRouteId());
    expect(ids.size).toBe(100_000);
  });

  it('honours a shorter length', () => {
    expect(createRouteId(8)).toHaveLength(8);
  });
});
