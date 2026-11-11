/**
 * The icons of the interface: shapes of the Lucide icon set (https://lucide.dev, ISC licence;
 * portions Copyright (c) Cole Bemis 2013-2022 as part of Feather, MIT; the rest Copyright (c) Lucide
 * Contributors 2022). Only the few that are used are copied here, as data: there is no dependency.
 * All are drawn on a 24 x 24 grid with a 2 px round stroke, so they look alike next to one another.
 * The licence text is in `docs/design-tokens.md`.
 */
export interface IconShape {
  /** `d` attribute of each path. */
  readonly paths?: readonly string[];
  /** Small dots, `[cx, cy]`, drawn with a radius of 1. */
  readonly dots?: readonly (readonly [number, number])[];
}

export const ICONS = {
  x: { paths: ['M18 6 6 18', 'm6 6 12 12'] },
  plus: { paths: ['M5 12h14', 'M12 5v14'] },
  minus: { paths: ['M5 12h14'] },
  swap: {
    paths: ['m21 16-4 4-4-4', 'M17 20V4', 'm3 8 4-4 4 4', 'M7 4v16'],
  },
  chevronDown: { paths: ['m6 9 6 6 6-6'] },
  grip: {
    dots: [
      [9, 12],
      [9, 5],
      [9, 19],
      [15, 12],
      [15, 5],
      [15, 19],
    ],
  },
} as const satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The icon as a DOM element, for the places Angular does not draw (the markers of the map).
 * `size` is in pixels; the colour is the text colour of the parent.
 */
export function iconElement(name: IconName, size: number): SVGSVGElement {
  const shape: IconShape = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of shape.paths ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  for (const [cx, cy] of shape.dots ?? []) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', '1');
    svg.append(dot);
  }
  return svg;
}
