import {
  FRANCE_BOX,
  MAP_VIEW_KEY,
  readStoredView,
  storeView,
  viewToFit,
} from './initial-view';

describe('initial view', () => {
  beforeEach(() => localStorage.removeItem(MAP_VIEW_KEY));
  afterEach(() => localStorage.removeItem(MAP_VIEW_KEY));

  it('keeps the last view and gives it back, and ignores what makes no sense', () => {
    expect(readStoredView()).toBeNull();
    storeView([3.1, 45.7], 12.5);
    expect(readStoredView()).toEqual({ center: [3.1, 45.7], zoom: 12.5 });
    localStorage.setItem(MAP_VIEW_KEY, '{"center":[500,45],"zoom":3}');
    expect(readStoredView()).toBeNull();
    localStorage.setItem(MAP_VIEW_KEY, 'not json');
    expect(readStoredView()).toBeNull();
  });

  it('fits France in a wide map, about the middle of the country', () => {
    const { center, zoom } = viewToFit(FRANCE_BOX, 1280, 700);
    expect(center[0]).toBeCloseTo(2.2, 0);
    expect(center[1]).toBeCloseTo(46.7, 0);
    // About the zoom of a country on a laptop.
    expect(zoom).toBeGreaterThan(5);
    expect(zoom).toBeLessThan(6.5);
  });

  it('zooms out for a smaller map, so that the whole box stays in sight', () => {
    const wide = viewToFit(FRANCE_BOX, 1280, 700);
    const phone = viewToFit(FRANCE_BOX, 412, 800);
    expect(phone.zoom).toBeLessThan(wide.zoom);
  });

  it('leaves the room of the panel: the country lands in the free part, to the right', () => {
    const free = viewToFit(FRANCE_BOX, 1280, 700);
    const withPanel = viewToFit(FRANCE_BOX, 1280, 700, {
      left: 360,
      top: 0,
      bottom: 0,
      right: 0,
    });
    // The map centre moves west so that France shows to the right of the panel.
    expect(withPanel.center[0]).toBeLessThan(free.center[0]);
    // The height decides here, so the zoom does not change.
    expect(withPanel.zoom).toBeLessThanOrEqual(free.zoom);
  });

  it('answers with a country-sized view for a map that has no size yet', () => {
    expect(viewToFit(FRANCE_BOX, 0, 0).zoom).toBe(5);
  });
});
