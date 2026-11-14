/**
 * A QR code encoder of our own (no dependency): one text as bytes (UTF-8), error correction
 * level L, versions 1 to 40, the mask with the lowest penalty. Written from ISO/IEC 18004, with
 * the structure of Nayuki's public domain reference generator. Level L keeps the code small and
 * easy to scan from a screen, which is the use here.
 */

export interface QrCode {
  /** Modules per side: 21 for version 1, up to 177. */
  readonly size: number;
  readonly version: number;
  /** True for a dark module, `x` to the right and `y` downwards. */
  isDark(x: number, y: number): boolean;
}

/** Error correction codewords per block, level L, by version (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
  28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  30, 30,
];
/** Number of error correction blocks, level L, by version (index 0 unused). */
const NUM_BLOCKS = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
  12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];
/** The two format bits of level L. */
const ECC_L_FORMAT_BITS = 1;
const MIN_VERSION = 1;
const MAX_VERSION = 40;

const bit = (value: number, index: number): boolean =>
  ((value >>> index) & 1) !== 0;

/** Modules in a version that can hold data and error correction (not the fixed patterns). */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** Bytes of data a version holds, once the error correction is taken out. */
function dataCodewords(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[version] * NUM_BLOCKS[version]
  );
}

/** The most bytes of text a version holds in byte mode (header: 4 bits + 8 or 16 of count). */
export function qrCapacityBytes(version: number): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}

// ---- Reed-Solomon over GF(2^8), polynomial 0x11D ----

function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree: number): number[] {
  const result: number[] = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainder(data: readonly number[], div: readonly number[]): number[] {
  const result: number[] = div.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    div.forEach((coef, i) => (result[i] ^= multiply(coef, factor)));
  }
  return result;
}

/** Splits the data in blocks, adds the error correction to each and interleaves them. */
function addEccAndInterleave(
  data: readonly number[],
  version: number,
): number[] {
  const blocks = NUM_BLOCKS[version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const rs = divisor(eccLen);
  const parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const length = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    const ecc = remainder(block, rs);
    // Short blocks get a placeholder so that every block has the same length.
    if (i < shortBlocks) block.push(0);
    parts.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    parts.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---- The matrix ----

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.fixed = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.drawFunctionPatterns();
  }

  private setFixed(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.fixed[y][x] = true;
  }

  private drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFixed(6, i, i % 2 === 0);
      this.setFixed(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const positions = alignmentPositions(this.version, this.size);
    const last = positions.length - 1;
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        // Not where a finder pattern already is.
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === last) ||
          (i === last && j === 0)
        ) {
          continue;
        }
        this.alignment(positions[i], positions[j]);
      }
    }
    // Reserve the format and version areas; the real values are written after the mask.
    this.drawFormat(0);
    this.drawVersion();
  }

  private finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFixed(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private alignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFixed(
          x + dx,
          y + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  drawFormat(mask: number): void {
    const data = (ECC_L_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.setFixed(8, i, bit(bits, i));
    this.setFixed(8, 7, bit(bits, 6));
    this.setFixed(8, 8, bit(bits, 7));
    this.setFixed(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFixed(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++)
      this.setFixed(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++)
      this.setFixed(8, this.size - 15 + i, bit(bits, i));
    // The module that is always dark.
    this.setFixed(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFixed(a, b, bit(bits, i));
      this.setFixed(b, a, bit(bits, i));
    }
  }

  /** Writes the codewords in the zigzag of two-module columns, from the bottom right. */
  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.fixed[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
          // Left-over bits (remainder modules) stay light.
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
        }
        if (!this.fixed[y][x] && invert)
          this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** How badly a mask scatters the modules (the lower the easier to scan): the four rules of the standard. */
  penalty(): number {
    const n = this.size;
    let score = 0;
    const lines: boolean[][] = [];
    for (let i = 0; i < n; i++) {
      lines.push(this.modules[i]);
      lines.push(this.modules.map((row) => row[i]));
    }
    const finderLike = ['10111010000', '00001011101'];
    for (const line of lines) {
      // Runs of 5 or more of one colour: 3 points, plus 1 for each module beyond 5.
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // Patterns that look like the finder pattern: 40 points each.
      const text = line.map((d) => (d ? '1' : '0')).join('');
      for (const pattern of finderLike) {
        for (
          let at = text.indexOf(pattern);
          at >= 0;
          at = text.indexOf(pattern, at + 1)
        ) {
          score += 40;
        }
      }
    }
    // 2x2 blocks of one colour: 3 points each.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = this.modules[y][x];
        if (
          c === this.modules[y][x + 1] &&
          c === this.modules[y + 1][x] &&
          c === this.modules[y + 1][x + 1]
        ) {
          score += 3;
        }
      }
    }
    // Balance of dark and light: 10 points for each 5% away from half.
    let dark = 0;
    for (const row of this.modules) for (const d of row) if (d) dark++;
    const percent = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;
  }
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

/** Text to the data codewords of a version: byte mode header, the bytes, terminator and padding. */
function dataFor(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  const capacityBits = dataCodewords(version) * 8;
  put(0, Math.min(4, capacityBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }
  for (
    let pad = 0xec;
    codewords.length < dataCodewords(version);
    pad ^= 0xec ^ 0x11
  ) {
    codewords.push(pad);
  }
  return codewords;
}

/**
 * The QR code of a text, or `null` when it does not fit in `maxVersion` (a bigger code is too
 * dense to scan from a screen). The text is encoded as UTF-8.
 */
export function encodeQr(
  text: string,
  maxVersion = MAX_VERSION,
): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  let version = MIN_VERSION;
  while (
    version <= Math.min(maxVersion, MAX_VERSION) &&
    bytes.length > qrCapacityBytes(version)
  ) {
    version++;
  }
  if (version > Math.min(maxVersion, MAX_VERSION)) return null;
  const matrix = new Matrix(version);
  matrix.drawCodewords(addEccAndInterleave(dataFor(bytes, version), version));
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    matrix.applyMask(mask);
    matrix.drawFormat(mask);
    const score = matrix.penalty();
    matrix.applyMask(mask);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
  }
  matrix.applyMask(best);
  matrix.drawFormat(best);
  return {
    size: matrix.size,
    version,
    isDark: (x, y) =>
      x >= 0 &&
      x < matrix.size &&
      y >= 0 &&
      y < matrix.size &&
      matrix.modules[y][x],
  };
}

/** The dark modules as one SVG path (`M x y h1 v1 h-1 z` per module), with a quiet zone around. */
export function qrSvgPath(qr: QrCode, border = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.isDark(x, y)) parts.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }
  return parts.join('');
}
