import { encodeQr, qrCapacityBytes, qrSvgPath, type QrCode } from './qr-code';

/**
 * The encoder is checked by a decoder written here from the standard's own tables (block layout,
 * alignment positions, format and version areas), sharing nothing with the encoder but the idea of
 * the zigzag: format bits and their error correction, the mask, the Reed-Solomon remainders of
 * every block, and the text read back.
 */

// ISO/IEC 18004 table 7: byte capacity at level L.
const CAPACITY_L: Record<number, number> = {
  1: 17,
  2: 32,
  3: 53,
  4: 78,
  5: 106,
  6: 134,
  7: 154,
  8: 192,
  9: 230,
  10: 271,
  11: 321,
  12: 367,
  13: 425,
  14: 458,
  15: 520,
  20: 858,
  40: 2953,
};

// Table 9 (level L): data codewords of each block, and error correction codewords per block.
const LAYOUT: Record<number, { data: number[]; ecc: number }> = {
  1: { data: [19], ecc: 7 },
  2: { data: [34], ecc: 10 },
  7: { data: [78, 78], ecc: 20 },
  10: { data: [68, 68, 69, 69], ecc: 18 },
  14: { data: [115, 115, 115, 116], ecc: 30 },
};

// Annex E: centres of the alignment patterns.
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  7: [6, 22, 38],
  10: [6, 28, 50],
  14: [6, 26, 46, 66],
};

// GF(256) by logarithm tables, not by the encoder's shift-and-add.
const EXP: number[] = [];
const LOG: number[] = new Array(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
const mul = (a: number, b: number) =>
  a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0;

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function isFunctionModule(
  x: number,
  y: number,
  version: number,
  size: number,
): boolean {
  if (x === 6 || y === 6) return true; // timing patterns
  if (x <= 8 && y <= 8) return true; // finder, separator and format (top left)
  if (x >= size - 8 && y <= 8) return true; // top right
  if (x <= 8 && y >= size - 8) return true; // bottom left
  if (version >= 7) {
    if (x >= size - 11 && x <= size - 9 && y <= 5) return true; // version info
    if (y >= size - 11 && y <= size - 9 && x <= 5) return true;
  }
  const centres = ALIGNMENT[version];
  const last = centres.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        continue;
      if (Math.abs(x - centres[i]) <= 2 && Math.abs(y - centres[j]) <= 2)
        return true;
    }
  }
  return false;
}

function decode(qr: QrCode): { text: string; mask: number } {
  const { size, version } = qr;
  const dark = (x: number, y: number) => (qr.isDark(x, y) ? 1 : 0);

  // Format information, read from both copies.
  const first: number[] = [];
  for (let i = 0; i <= 5; i++) first.push(dark(8, i));
  first.push(dark(8, 7), dark(8, 8), dark(7, 8));
  for (let i = 9; i < 15; i++) first.push(dark(14 - i, 8));
  const second: number[] = [];
  for (let i = 0; i < 8; i++) second.push(dark(size - 1 - i, 8));
  for (let i = 8; i < 15; i++) second.push(dark(8, size - 15 + i));
  expect(second).toEqual(first);
  let format = first.reduce((acc, b, i) => acc | (b << i), 0) ^ 0x5412;
  const data = format >> 10;
  for (let i = 14; i >= 10; i--)
    if ((format >> i) & 1) format ^= 0x537 << (i - 10);
  expect(format).toBe(0); // the BCH code of the format is valid
  expect(data >> 3).toBe(1); // level L
  const mask = data & 7;
  expect(dark(8, size - 8)).toBe(1); // the module that is always dark

  // The data modules, in the zigzag, unmasked.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let n = 0; n < size; n++) {
      for (const x of [right, right - 1]) {
        const y = upward ? size - 1 - n : n;
        if (isFunctionModule(x, y, version, size)) continue;
        bits.push(dark(x, y) ^ (MASKS[mask](x, y) ? 1 : 0));
      }
    }
  }
  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    stream.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }

  // Undo the interleaving and check every block's Reed-Solomon remainder.
  const { data: lengths, ecc } = LAYOUT[version];
  const blocks: number[][] = lengths.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...lengths); i++) {
    lengths.forEach((length, b) => {
      if (i < length) blocks[b].push(stream[at++]);
    });
  }
  const eccs: number[][] = lengths.map(() => []);
  for (let i = 0; i < ecc; i++)
    lengths.forEach((_l, b) => eccs[b].push(stream[at++]));
  blocks.forEach((block, b) => {
    const word = [...block, ...eccs[b]];
    for (let root = 0; root < ecc; root++) {
      // The word is a polynomial, highest degree first: evaluate it at alpha^root.
      const value = word.reduce((acc, c) => mul(acc, EXP[root]) ^ c, 0);
      expect(value).toBe(0);
    }
  });

  // Byte mode: 0100, the length, the bytes.
  const payload = blocks.flat();
  const all = payload.map((b) => b.toString(2).padStart(8, '0')).join('');
  expect(all.slice(0, 4)).toBe('0100');
  const countBits = version <= 9 ? 8 : 16;
  const count = parseInt(all.slice(4, 4 + countBits), 2);
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = 4 + countBits + i * 8;
    bytes.push(parseInt(all.slice(from, from + 8), 2));
  }
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), mask };
}

const sample = (length: number) =>
  Array.from(
    { length },
    (_, i) => 'voielibre.app/r#v=1&p=road&c=AZaz09-_'[(i * 7) % 36],
  ).join('');

describe('QR code encoder', () => {
  it.each(Object.entries(CAPACITY_L))(
    'holds %s bytes at version %s... as the standard says',
    (version, bytes) => {
      expect(qrCapacityBytes(Number(version))).toBe(bytes);
    },
  );

  it.each([
    [1, 10],
    [2, 30],
    [7, 150],
    [10, 270],
    [14, 450],
  ])(
    'version %i: a text of %i bytes reads back, with valid blocks and format',
    (version, length) => {
      const text = sample(length);
      const qr = encodeQr(text);
      expect(qr?.version).toBe(version);
      expect(qr?.size).toBe(version * 4 + 17);
      expect(decode(qr as QrCode).text).toBe(text);
    },
  );

  it('takes the smallest version that holds the text', () => {
    expect(encodeQr(sample(17))?.version).toBe(1);
    expect(encodeQr(sample(18))?.version).toBe(2);
    expect(encodeQr(sample(271))?.version).toBe(10);
    expect(encodeQr(sample(272))?.version).toBe(11);
  });

  it('writes UTF-8', () => {
    const text = 'Ventouse, été → Issoire';
    expect(decode(encodeQr(text) as QrCode).text).toBe(text);
  });

  it('draws the three finder patterns and the timing pattern', () => {
    const qr = encodeQr('x') as QrCode;
    for (const [ox, oy] of [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ]) {
      for (let i = 0; i < 7; i++) {
        for (const [x, y] of [
          [ox + i, oy],
          [ox + i, oy + 6],
          [ox, oy + i],
          [ox + 6, oy + i],
        ]) {
          expect(qr.isDark(x, y)).toBe(true);
        }
      }
      expect(qr.isDark(ox + 1, oy + 1)).toBe(false);
      expect(qr.isDark(ox + 3, oy + 3)).toBe(true);
    }
    for (let i = 8; i < qr.size - 8; i++)
      expect(qr.isDark(i, 6)).toBe(i % 2 === 0);
  });

  it('gives nothing when the text does not fit in the version allowed', () => {
    expect(encodeQr(sample(300), 10)).toBeNull();
    expect(encodeQr(sample(300), 11)).not.toBeNull();
    expect(encodeQr(sample(3000))).toBeNull();
  });

  it('draws the dark modules as one path with a quiet zone', () => {
    const qr = encodeQr('x') as QrCode;
    const path = qrSvgPath(qr, 4);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect((path.match(/M/g) ?? []).length).toBe(
      Array.from({ length: qr.size * qr.size }, (_, i) =>
        qr.isDark(i % qr.size, Math.floor(i / qr.size)),
      ).filter(Boolean).length,
    );
  });
});
