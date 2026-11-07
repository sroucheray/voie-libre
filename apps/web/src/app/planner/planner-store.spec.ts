import { TestBed } from '@angular/core/testing';
import {
  MAX_ALTERNATIVES,
  MAX_POINTS,
  PlannedRoute,
  PlannerStore,
  pointRole,
} from './planner-store';

const route: PlannedRoute = {
  geometry: [
    [3, 45, 400],
    [3.1, 45.1, 410],
  ],
  distanceMeters: 1000,
  ascentMeters: 10,
  durationSeconds: 300,
};

describe('PlannerStore', () => {
  let store: PlannerStore;

  beforeEach(() => {
    store = TestBed.inject(PlannerStore);
  });

  describe('points', () => {
    it('sets the start with the first click and the end with the second', () => {
      store.addPoint([3, 45]);
      expect(store.points()).toEqual([[3, 45]]);
      store.addPoint([3.2, 45.2]);
      expect(store.points()).toEqual([
        [3, 45],
        [3.2, 45.2],
      ]);
    });

    it('tells what the next click creates', () => {
      expect(store.nextRole()).toBe('start');
      store.addPoint([1, 1]);
      expect(store.nextRole()).toBe('end');
      store.addPoint([9, 9]);
      expect(store.nextRole()).toBe('waypoint');
    });

    it('inserts a waypoint at the given index, never before the start or after the end', () => {
      store.addPoint([1, 1]);
      store.addPoint([9, 9]);
      store.addPoint([2, 2]);
      store.insertPoint(2, [5, 5]);
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
        [5, 5],
        [9, 9],
      ]);
      store.insertPoint(0, [0, 0]);
      expect(store.points()[1]).toEqual([0, 0]);
      store.insertPoint(99, [8, 8]);
      expect(store.points()[store.points().length - 2]).toEqual([8, 8]);
      expect(store.points()[store.points().length - 1]).toEqual([9, 9]);
    });

    it('does not insert without a start and an end', () => {
      store.addPoint([1, 1]);
      store.insertPoint(1, [2, 2]);
      expect(store.points()).toEqual([[1, 1]]);
    });

    it('closes a loop by putting the end on the start', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      expect(store.isLoop()).toBe(false);
      store.closeLoop();
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
        [1, 1],
      ]);
      expect(store.isLoop()).toBe(true);
      store.closeLoop();
      expect(store.points().length).toBe(3);
    });

    it('does not close a loop with fewer than two points', () => {
      store.addPoint([1, 1]);
      store.closeLoop();
      expect(store.points()).toEqual([[1, 1]]);
      expect(store.isLoop()).toBe(false);
    });

    it('moves the start and the end of a loop together', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop();
      store.movePoint(0, [5, 5]);
      expect(store.points()).toEqual([
        [5, 5],
        [2, 2],
        [5, 5],
      ]);
      store.movePoint(2, [6, 6]);
      expect(store.points()).toEqual([
        [6, 6],
        [2, 2],
        [6, 6],
      ]);
      store.movePoint(1, [3, 3]);
      expect(store.points()).toEqual([
        [6, 6],
        [3, 3],
        [6, 6],
      ]);
    });

    it('does not close a loop beyond the maximum number of points', () => {
      for (let i = 0; i < MAX_POINTS; i++) store.addPoint([i, i]);
      store.closeLoop();
      expect(store.points().length).toBe(MAX_POINTS);
    });

    it('inserts further points as waypoints just before the end', () => {
      store.addPoint([1, 1]);
      store.addPoint([9, 9]);
      store.addPoint([2, 2]);
      store.addPoint([3, 3]);
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
        [9, 9],
      ]);
    });

    it(`ignores points beyond ${MAX_POINTS}`, () => {
      for (let i = 0; i < MAX_POINTS + 5; i++) store.addPoint([i, i]);
      expect(store.points()).toHaveLength(MAX_POINTS);
      expect(store.points()[MAX_POINTS - 1]).toEqual([1, 1]);
    });

    it('moves a point and ignores an unknown index', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.movePoint(1, [5, 5]);
      store.movePoint(7, [6, 6]);
      expect(store.points()).toEqual([
        [1, 1],
        [5, 5],
      ]);
    });

    it('removes a point; the last one becomes the end', () => {
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ].forEach((p) => store.addPoint(p as [number, number]));
      store.removePoint(2);
      expect(store.points()).toEqual([
        [1, 1],
        [3, 3],
      ]);
    });

    it('clears everything', () => {
      store.addPoint([1, 1]);
      store.clear();
      expect(store.points()).toEqual([]);
    });
  });

  describe('pointRole', () => {
    it.each([
      [0, 1, 'start'],
      [0, 2, 'start'],
      [1, 2, 'end'],
      [1, 3, 'waypoint'],
      [2, 3, 'end'],
    ] as const)('point %i of %i is the %s', (index, total, role) => {
      expect(pointRole(index, total)).toBe(role);
    });
  });

  describe('options', () => {
    it('starts on the road profile with one route', () => {
      expect(store.profile()).toBe('road');
      expect(store.alternatives()).toBe(1);
    });

    it(`keeps alternatives between 1 and ${MAX_ALTERNATIVES}`, () => {
      store.setAlternatives(0);
      expect(store.alternatives()).toBe(1);
      store.setAlternatives(9);
      expect(store.alternatives()).toBe(MAX_ALTERNATIVES);
      store.setAlternatives(2);
      expect(store.alternatives()).toBe(2);
    });

    it('changes the profile', () => {
      store.setProfile('trail');
      expect(store.profile()).toBe('trail');
    });
  });

  describe('result', () => {
    it('selects the first route when routes arrive, and only valid indexes afterwards', () => {
      store.setRoutes([route, route, route]);
      expect(store.status()).toBe('ready');
      expect(store.selectedIndex()).toBe(0);
      store.selectRoute(2);
      expect(store.selectedIndex()).toBe(2);
      store.selectRoute(3);
      store.selectRoute(-1);
      expect(store.selectedIndex()).toBe(2);
      store.setRoutes([route]);
      expect(store.selectedIndex()).toBe(0);
    });

    it('keeps the previous routes while loading', () => {
      store.setRoutes([route]);
      store.startLoading();
      expect(store.status()).toBe('loading');
      expect(store.routes()).toHaveLength(1);
    });

    it('drops the routes and keeps the code on error', () => {
      store.setRoutes([route]);
      store.setError('no_route');
      expect(store.status()).toBe('error');
      expect(store.errorCode()).toBe('no_route');
      expect(store.routes()).toEqual([]);
      store.startLoading();
      expect(store.errorCode()).toBeNull();
    });

    it('goes back to idle when there is nothing to compute', () => {
      store.setError('unavailable');
      store.resetResult();
      expect(store.status()).toBe('idle');
      expect(store.errorCode()).toBeNull();
    });
  });
});
