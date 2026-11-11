import { PALETTE_TOKENS } from './palette';
// The raw text of the design tokens (esbuild's `?raw` loader).
import tokens from '../../../design-tokens.css?raw';

const tokenValue = (name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim().toLowerCase();

describe('palette', () => {
  it('reads the design tokens', () => {
    expect(tokens).toContain('--color-accent');
  });

  it.each(Object.entries(PALETTE_TOKENS))(
    'keeps %s equal to the CSS token',
    (name, value) => {
      expect(tokenValue(name)).toBe(value.toLowerCase());
    },
  );
});
