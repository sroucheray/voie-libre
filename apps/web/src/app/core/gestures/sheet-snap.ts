export type SheetState = 'peek' | 'half' | 'full';

export const SHEET_STATES: readonly SheetState[] = ['peek', 'half', 'full'];

/** Speed in pixels per millisecond above which a release is a flick, whatever the distance. */
export const FLICK_SPEED = 0.5;

/** The height in pixels of each state: `peek` is fixed, `half` is half the stage, `full` all of it. */
export function sheetHeights(
  stage: number,
  peek: number,
): Record<SheetState, number> {
  return {
    peek: Math.min(peek, stage),
    half: Math.max(peek, Math.round(stage / 2)),
    full: Math.max(peek, stage),
  };
}

/**
 * The state to settle on after a release at `height`. `velocity` is the speed of the finger in px/ms,
 * positive going up: a flick goes to the next state in its direction, a slow release to the nearest.
 */
export function snapTo(
  height: number,
  velocity: number,
  heights: Record<SheetState, number>,
  from: SheetState,
): SheetState {
  const index = SHEET_STATES.indexOf(from);
  if (Math.abs(velocity) >= FLICK_SPEED) {
    const next = index + (velocity > 0 ? 1 : -1);
    return SHEET_STATES[Math.min(SHEET_STATES.length - 1, Math.max(0, next))];
  }
  return SHEET_STATES.reduce((best, state) =>
    Math.abs(heights[state] - height) < Math.abs(heights[best] - height)
      ? state
      : best,
  );
}

/** A tap on the handle: peek, half, full, then back to peek. */
export function nextState(state: SheetState): SheetState {
  return SHEET_STATES[(SHEET_STATES.indexOf(state) + 1) % SHEET_STATES.length];
}

/** The arrow keys on the handle: up goes one state higher, down one lower, never past the ends. */
export function stepState(state: SheetState, up: boolean): SheetState {
  const index = SHEET_STATES.indexOf(state) + (up ? 1 : -1);
  return SHEET_STATES[Math.min(SHEET_STATES.length - 1, Math.max(0, index))];
}
