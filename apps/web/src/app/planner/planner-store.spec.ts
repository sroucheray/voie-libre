import { TestBed } from '@angular/core/testing';
import {
  HISTORY_DEPTH,
  MAX_ALTERNATIVES,
  MAX_POINTS,
  PlannedRoute,
  PlannerStore,
  inputsSignature,
  pointRole,
} from './planner-store';
import type { LngLat3 } from './planner-map-driver';

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

    it('keeps the way-back mode while it fits the points', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop({ mode: 'avoid_outbound' });
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
        [1, 1],
      ]);
      expect(store.loop()).toEqual({ mode: 'avoid_outbound' });
      store.setEnd([5, 5]);
      expect(store.loop()).toBeNull();
    });

    it('draws a loop by distance from the start alone', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop({ mode: 'distance', distanceMeters: 40_000 });
      expect(store.points()).toEqual([
        [1, 1],
        [1, 1],
      ]);
      expect(store.isLoop()).toBe(true);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 40_000,
      });
    });

    it('stops sending the distance once a stop is added, and keeps it within limits', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop({ mode: 'distance', distanceMeters: 40_000 });
      store.setLoopDistance(1);
      expect(store.loop()).toEqual({ mode: 'distance', distanceMeters: 2_000 });
      store.setLoopDistance(9_000_000);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 200_000,
      });
      store.addPoint([3, 3]);
      expect(store.loop()).toBeNull();
    });

    it('keeps a climb with the loop, within limits, and drops it when emptied', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop({ mode: 'distance', distanceMeters: 40_000 });
      store.setLoopAscent(800);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 40_000,
        ascentMeters: 800,
      });
      store.setLoopDistance(20_000);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 20_000,
        ascentMeters: 800,
      });
      store.setLoopAscent(99_999);
      expect(store.loop()).toMatchObject({ ascentMeters: 10_000 });
      store.setLoopAscent(null);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 20_000,
      });
    });

    it('keeps a direction with the loop, through its other settings and undo', () => {
      store.addPoint([1, 1]);
      store.closeLoop({ mode: 'distance', distanceMeters: 40_000 });
      store.setLoopDirection('sw');
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 40_000,
        direction: 'sw',
      });
      store.setLoopDistance(20_000);
      store.setLoopAscent(500);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 20_000,
        ascentMeters: 500,
        direction: 'sw',
      });
      store.setLoopDirection(null);
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 20_000,
        ascentMeters: 500,
      });
      store.undo();
      expect(store.loop()).toMatchObject({ direction: 'sw' });
      // Asking for the same direction again is not a change.
      store.setLoopDirection('sw');
      store.undo();
      expect(store.loop()).toMatchObject({ direction: 'sw' });
      expect(store.loop()).not.toHaveProperty('ascentMeters');
    });

    it('forgets the mode when everything is cleared', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop({ mode: 'avoid_outbound' });
      store.clear();
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop();
      expect(store.loop()).toBeNull();
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

    it('sets the start and the end from anywhere', () => {
      store.setStart([1, 1]);
      expect(store.points()).toEqual([[1, 1]]);
      store.setEnd([2, 2]);
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
      ]);
      store.setStart([3, 3]);
      store.setEnd([4, 4]);
      expect(store.points()).toEqual([
        [3, 3],
        [4, 4],
      ]);
    });

    it('opens a loop when its end is set elsewhere', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.closeLoop();
      store.setEnd([5, 5]);
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
        [5, 5],
      ]);
      expect(store.isLoop()).toBe(false);
    });

    it('puts back a removed point where it was', () => {
      store.addPoint([1, 1]);
      store.addPoint([9, 9]);
      store.addPoint([2, 2]);
      store.removePoint(1);
      expect(store.points()).toEqual([
        [1, 1],
        [9, 9],
      ]);
      expect(store.removed()).toEqual({ index: 1, point: [2, 2] });
      store.undoRemove();
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
        [9, 9],
      ]);
      expect(store.removed()).toBeNull();
    });

    it('moves a point to another place in the list, and undoes it', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.addPoint([3, 3]);
      // The third point lands before the end: [1, 1], [3, 3], [2, 2].
      store.reorderPoint(0, 2);
      expect(store.points()).toEqual([
        [3, 3],
        [2, 2],
        [1, 1],
      ]);
      store.undo();
      expect(store.points()).toEqual([
        [1, 1],
        [3, 3],
        [2, 2],
      ]);
    });

    it('swaps the start and the end, keeping the stops, and undoes it', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.addPoint([3, 3]);
      store.swapEnds();
      expect(store.points()).toEqual([
        [2, 2],
        [3, 3],
        [1, 1],
      ]);
      store.undo();
      expect(store.points()).toEqual([
        [1, 1],
        [3, 3],
        [2, 2],
      ]);
    });

    it('does not swap a loop or fewer than two points', () => {
      store.addPoint([1, 1]);
      store.swapEnds();
      expect(store.points()).toEqual([[1, 1]]);
      store.addPoint([2, 2]);
      store.closeLoop();
      const before = store.points();
      store.swapEnds();
      expect(store.points()).toBe(before);
    });

    it('names places by position, so a name follows its point', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.setLabel([1, 1], 'Gare de Lyon, Paris');
      expect(store.labelOf([1, 1])).toBe('Gare de Lyon, Paris');
      expect(store.labelOf([2, 2])).toBeNull();
      store.swapEnds();
      expect(store.labelOf(store.points()[1])).toBe('Gare de Lyon, Paris');
      store.setLabel([1, 1], 'Renamed');
      expect(store.labelOf([1, 1])).toBe('Renamed');
    });

    it('asks no lookup for the ends of an opened route, until they change', () => {
      store.loadSaved({
        points: [
          [1, 1],
          [2, 2],
        ],
        profile: 'road',
        geometry: route.geometry,
        distanceMeters: 1,
        ascentMeters: 1,
        durationSeconds: 1,
      });
      expect(store.lookupWanted([1, 1])).toBe(false);
      expect(store.lookupWanted([2, 2])).toBe(false);
      expect(store.lookupWanted([3, 3])).toBe(true);
    });

    it('forgets the oldest names beyond the limit', () => {
      for (let i = 0; i < 105; i++) store.setLabel([i, 0], `place ${i}`);
      expect(store.labelOf([0, 0])).toBeNull();
      expect(store.labelOf([104, 0])).toBe('place 104');
    });

    it('ignores a move onto itself or outside the list', () => {
      store.addPoint([1, 1]);
      store.addPoint([2, 2]);
      store.reorderPoint(1, 1);
      store.reorderPoint(0, 5);
      store.reorderPoint(3, 0);
      expect(store.points()).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect(store.canUndo()).toBe(true);
      store.undo();
      store.undo();
      expect(store.canUndo()).toBe(false);
    });

    it('forgets the removed point when asked, and when everything is cleared', () => {
      store.addPoint([1, 1]);
      store.removePoint(0);
      store.forgetRemoved();
      expect(store.removed()).toBeNull();
      store.addPoint([1, 1]);
      store.removePoint(0);
      store.clear();
      expect(store.removed()).toBeNull();
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

  describe('point edits', () => {
    const A: [number, number] = [3, 45];
    const B: [number, number] = [3.1, 45];
    const C: [number, number] = [3.2, 45];
    const X: [number, number] = [3.05, 45.01];
    /** The route of the points is on screen: an edit can be applied to it. */
    const onScreen = () => store.setRoutes([route]);

    it('remembers no edit while there is no route to edit', () => {
      store.addPoint(A);
      expect(store.editBehind(store.points())).toBeNull();
      store.addPoint(B);
      expect(store.editBehind(store.points())).toBeNull();
    });

    it('remembers no edit when the route on screen is not the one of the points it started from', () => {
      store.addPoint(A);
      store.addPoint(C);
      onScreen();
      store.addPoint(X);
      // The route of that edit has not come yet: the next edit starts from a route that is stale.
      store.addPoint([3.15, 45.02]);
      expect(store.editBehind(store.points())).toBeNull();
    });

    it('remembers a point added before the end', () => {
      store.addPoint(A);
      store.addPoint(C);
      onScreen();
      const before = store.points();
      store.addPoint(X);
      expect(store.editBehind(store.points())).toEqual({
        kind: 'insert',
        index: 1,
        point: X,
        previous: before,
        next: store.points(),
      });
    });

    it('remembers a point inserted at its index, kept between start and end', () => {
      store.addPoint(A);
      store.addPoint(C);
      onScreen();
      store.insertPoint(0, X);
      expect(store.editBehind(store.points())).toMatchObject({
        kind: 'insert',
        index: 1,
        point: X,
      });
    });

    it('remembers a point moved and where it was', () => {
      store.addPoint(A);
      store.addPoint(B);
      store.addPoint(C);
      // Points are now [A, C, B]: a click adds a waypoint before the end.
      onScreen();
      store.movePoint(1, X);
      expect(store.editBehind(store.points())).toMatchObject({
        kind: 'move',
        index: 1,
        from: C,
        point: X,
      });
    });

    it('remembers the end moved', () => {
      store.addPoint(A);
      store.addPoint(B);
      onScreen();
      store.setEnd(C);
      expect(store.editBehind(store.points())).toMatchObject({
        kind: 'move',
        index: 1,
        from: B,
        point: C,
      });
    });

    it('remembers no edit when both ends of a loop move together', () => {
      store.addPoint(A);
      store.addPoint(B);
      store.closeLoop();
      store.movePoint(0, X);
      expect(store.points()[2]).toEqual(X);
      expect(store.editBehind(store.points())).toBeNull();
    });

    it('remembers a point removed, and the undo as an insert', () => {
      store.addPoint(A);
      store.addPoint(B);
      store.addPoint(C);
      onScreen();
      store.removePoint(1);
      expect(store.editBehind(store.points())).toMatchObject({
        kind: 'remove',
        index: 1,
        point: C,
      });
      onScreen();
      store.undoRemove();
      expect(store.editBehind(store.points())).toMatchObject({
        kind: 'insert',
        index: 1,
        point: C,
      });
    });

    it('forgets an edit once the points changed some other way', () => {
      store.addPoint(A);
      store.addPoint(C);
      onScreen();
      store.addPoint(X);
      expect(store.editBehind(store.points())).not.toBeNull();
      store.closeLoop();
      expect(store.editBehind(store.points())).toBeNull();
    });
  });

  describe('applyLocalEdit', () => {
    /** A straight route along the equator, one vertex per 0.001° (about 111 m). */
    const geometry: LngLat3[] = Array.from({ length: 201 }, (_, i) => [
      i / 1000,
      0,
      100,
    ]);
    const planned: PlannedRoute = {
      geometry,
      distanceMeters: 22_000,
      ascentMeters: 50,
      durationSeconds: 3600,
      elevationSource: 'srtm',
    };
    const stretch = {
      geometry: [
        [0.095, 0, 100],
        [0.1, 0.003, 100],
        [0.105, 0, 100],
      ] as LngLat3[],
      distanceMeters: 1300,
      ascentMeters: 0,
      durationSeconds: 200,
    };

    beforeEach(() => {
      store.addPoint([0, 0]);
      store.addPoint([0.2, 0]);
      store.setAlternatives(3);
      store.setRoutes([planned, { ...planned, distanceMeters: 23_000 }]);
      store.selectRoute(1);
    });

    it('keeps only the selected route, with the stretch spliced in', () => {
      store.applyLocalEdit({ from: 95, to: 105 }, stretch);
      expect(store.routes()).toHaveLength(1);
      expect(store.selectedIndex()).toBe(0);
      const [edited] = store.routes();
      expect(edited.geometry).toHaveLength(95 + 3 + 95);
      expect(edited.geometry.slice(95, 98)).toEqual(stretch.geometry);
      expect(edited.distanceMeters).toBeCloseTo(
        23_000 * (1 - 1112 / 22_239) + 1300,
        -1,
      );
      expect(edited.elevationSource).toBe('srtm');
      expect(store.status()).toBe('ready');
      expect(store.errorCode()).toBeNull();
    });

    it('goes back to one alternative and counts as restored', () => {
      store.applyLocalEdit({ from: 95, to: 105 }, stretch);
      expect(store.alternatives()).toBe(1);
      expect(
        store.isRestored(
          inputsSignature(store.points(), store.profile(), 1, store.loop()),
        ),
      ).toBe(true);
    });

    it('does nothing without a route', () => {
      store.resetResult();
      store.applyLocalEdit({ from: 95, to: 105 }, stretch);
      expect(store.routes()).toEqual([]);
      expect(store.status()).toBe('idle');
      expect(store.alternatives()).toBe(3);
    });
  });

  describe('history', () => {
    /** Two points with their route on screen, as the planner leaves them once computed. */
    const computed = () => {
      store.addPoint([3, 45]);
      store.addPoint([3.2, 45.2]);
      store.setRoutes([route]);
    };

    it('starts empty', () => {
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
      store.undo();
      store.redo();
      expect(store.points()).toEqual([]);
    });

    it('undoes and redoes the points', () => {
      store.addPoint([3, 45]);
      store.addPoint([3.2, 45.2]);
      store.undo();
      expect(store.points()).toEqual([[3, 45]]);
      store.undo();
      expect(store.points()).toEqual([]);
      expect(store.canUndo()).toBe(false);
      store.redo();
      store.redo();
      expect(store.points()).toEqual([
        [3, 45],
        [3.2, 45.2],
      ]);
      expect(store.canRedo()).toBe(false);
    });

    it('undoes a move, an insert, a removal and a clear', () => {
      computed();
      store.insertPoint(1, [3.1, 45.1]);
      store.movePoint(1, [3.15, 45.12]);
      store.removePoint(1);
      store.clear();
      store.undo();
      expect(store.points()).toHaveLength(2);
      store.undo();
      expect(store.points()[1]).toEqual([3.15, 45.12]);
      store.undo();
      expect(store.points()[1]).toEqual([3.1, 45.1]);
      store.undo();
      expect(store.points()).toHaveLength(2);
    });

    it('undoes the profile, the alternatives and the loop settings', () => {
      computed();
      store.setProfile('gravel');
      store.setAlternatives(2);
      store.closeLoop({ mode: 'distance', distanceMeters: 30_000 });
      store.setLoopDistance(40_000);
      store.setLoopAscent(800);
      store.undo();
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 40_000,
      });
      store.undo();
      expect(store.loop()).toEqual({
        mode: 'distance',
        distanceMeters: 30_000,
      });
      store.undo();
      expect(store.loop()).toBeNull();
      expect(store.points()).toHaveLength(2);
      store.undo();
      expect(store.alternatives()).toBe(1);
      store.undo();
      expect(store.profile()).toBe('road');
    });

    it('does not record a change that changes nothing', () => {
      store.setProfile('road');
      store.setAlternatives(store.alternatives());
      store.clear();
      expect(store.canUndo()).toBe(false);
    });

    it('brings back the route that was on screen, without computing', () => {
      computed();
      store.setProfile('trail');
      store.startLoading();
      store.setRoutes([{ ...route, distanceMeters: 2000 }]);
      store.undo();
      expect(store.profile()).toBe('road');
      expect(store.routes()).toEqual([route]);
      expect(store.status()).toBe('ready');
      expect(
        store.isRestored(
          inputsSignature(store.points(), 'road', store.alternatives()),
        ),
      ).toBe(true);
      store.redo();
      expect(store.profile()).toBe('trail');
      expect(store.routes()[0].distanceMeters).toBe(2000);
      expect(store.status()).toBe('ready');
    });

    it('keeps no route for a state that was not up to date with its points', () => {
      computed();
      store.addPoint([3.1, 45.1]);
      // The route on screen is that of the two first points: the third is still to be computed.
      store.addPoint([3.15, 45.12]);
      store.undo();
      expect(store.points()).toHaveLength(3);
      expect(store.routes()).toEqual([]);
      expect(store.status()).toBe('idle');
      expect(store.isRestored(JSON.stringify('x'))).toBe(false);
    });

    it('empties what can be redone when a new change is made', () => {
      store.addPoint([3, 45]);
      store.addPoint([3.2, 45.2]);
      store.undo();
      expect(store.canRedo()).toBe(true);
      store.addPoint([4, 46]);
      expect(store.canRedo()).toBe(false);
    });

    it('keeps the last steps only', () => {
      for (let i = 0; i < HISTORY_DEPTH + 5; i++) {
        store.setStart([i, i]);
      }
      let undone = 0;
      while (store.canUndo()) {
        store.undo();
        undone++;
      }
      expect(undone).toBe(HISTORY_DEPTH);
    });

    it('forgets the history when a saved route is opened', () => {
      computed();
      store.setProfile('gravel');
      store.undo();
      store.loadSaved({
        points: [
          [3, 45],
          [3.2, 45.2],
        ],
        profile: 'road',
        geometry: route.geometry,
        distanceMeters: 1000,
        ascentMeters: 10,
        durationSeconds: 300,
      });
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });

    it('goes along with the removal toast', () => {
      computed();
      store.insertPoint(1, [3.1, 45.1]);
      store.removePoint(1);
      expect(store.removed()).not.toBeNull();
      store.undo();
      expect(store.removed()).toBeNull();
      expect(store.points()).toHaveLength(3);
      store.redo();
      expect(store.points()).toHaveLength(2);
      // The toast is not shown again by a redo.
      expect(store.removed()).toBeNull();
      store.undo();
      store.removePoint(1);
      store.undoRemove();
      expect(store.points()).toHaveLength(3);
      store.undo();
      expect(store.points()).toHaveLength(2);
    });

    it('lets the next edit be a local one after an undo', () => {
      computed();
      store.insertPoint(1, [3.1, 45.1]);
      store.undo();
      store.insertPoint(1, [3.12, 45.11]);
      expect(store.editBehind(store.points())).toMatchObject({
        kind: 'insert',
        index: 1,
      });
    });
  });
});
