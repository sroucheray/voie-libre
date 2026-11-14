import type { Profile } from '../planner/planner-store';
import {
  type GpxImportErrorCode,
  type ImportedRoute,
  type RawPoint,
  routeFromPoints,
} from './gpx-import';

/** Largest file read, in bytes: a day of 1 Hz recording is a few megabytes. */
export const MAX_FIT_BYTES = 30 * 1024 * 1024;

export class FitImportError extends Error {
  constructor(readonly code: GpxImportErrorCode) {
    super(code);
  }
}

// What the reader looks for in the messages of the FIT profile.
const MESSAGE_FILE_ID = 0;
const MESSAGE_SESSION = 18;
const MESSAGE_LAP = 19;
const MESSAGE_RECORD = 20;
const MESSAGE_COURSE = 31;

const FIELD_TIMESTAMP = 253;
/** Record fields. */
const RECORD_LATITUDE = 0;
const RECORD_LONGITUDE = 1;
const RECORD_ALTITUDE = 2;
const RECORD_ENHANCED_ALTITUDE = 78;
/** Session and lap field: the time the timer ran, in milliseconds. */
const TIMER_TIME = 8;
const COURSE_NAME = 5;

/** The invalid value of each base type is its biggest (or, for the signed ones, the biggest positive). */
const SINT32_INVALID = 0x7fffffff;
const UINT16_INVALID = 0xffff;
const UINT32_INVALID = 0xffffffff;

/** Altitude: (meters + 500) × 5. */
const altitudeMeters = (raw: number) => raw / 5 - 500;
/** Degrees from the FIT "semicircles": 2³¹ for 180°. */
const degrees = (semicircles: number) => (semicircles * 180) / 2 ** 31;

/** How much of the track must have an altitude for the climb to be believed. */
const MIN_ALTITUDE_SHARE = 0.9;

interface FieldDefinition {
  num: number;
  size: number;
  /** Base type number (the code without its endian flag). */
  type: number;
  offset: number;
}

interface Definition {
  global: number;
  little: boolean;
  fields: FieldDefinition[];
  /** Bytes of the data message: the fields, then the developer fields, which are skipped. */
  size: number;
}

/** What is collected while the messages are read. */
interface Collected {
  fileType: number | null;
  name: string | null;
  /** Total timer time in seconds, from the session (else the laps). */
  sessionSeconds: number | null;
  lapSeconds: number;
  timestamps: number[];
  records: { lon: number; lat: number; ele: number | null }[];
}

/** A damaged or unexpected file: no message can be trusted from there on. */
class Malformed extends Error {}

/** The unsigned or signed integer of `size` bytes at `offset` (1, 2 or 4). */
function readInt(
  view: DataView,
  offset: number,
  size: number,
  signed: boolean,
  little: boolean,
): number | null {
  switch (size) {
    case 1:
      return signed ? view.getInt8(offset) : view.getUint8(offset);
    case 2:
      return signed
        ? view.getInt16(offset, little)
        : view.getUint16(offset, little);
    case 4:
      return signed
        ? view.getInt32(offset, little)
        : view.getUint32(offset, little);
    default:
      return null;
  }
}

/** The field `num` of a data message as an unsigned integer, or null when it is absent or invalid. */
function unsigned(
  view: DataView,
  definition: Definition,
  position: number,
  num: number,
  size: 2 | 4,
): number | null {
  const field = definition.fields.find((f) => f.num === num);
  if (!field || field.size !== size) return null;
  const value = readInt(
    view,
    position + field.offset,
    size,
    false,
    definition.little,
  );
  return value === null ||
    value === (size === 2 ? UINT16_INVALID : UINT32_INVALID)
    ? null
    : value;
}

function readMessage(
  view: DataView,
  bytes: Uint8Array,
  definition: Definition,
  position: number,
  into: Collected,
): void {
  switch (definition.global) {
    case MESSAGE_RECORD: {
      const find = (num: number) =>
        definition.fields.find((f) => f.num === num && f.size === 4);
      const lat = find(RECORD_LATITUDE);
      const lon = find(RECORD_LONGITUDE);
      if (!lat || !lon) return;
      const latitude = view.getInt32(position + lat.offset, definition.little);
      const longitude = view.getInt32(position + lon.offset, definition.little);
      if (latitude === SINT32_INVALID || longitude === SINT32_INVALID) return;
      const point = { lat: degrees(latitude), lon: degrees(longitude) };
      if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return;
      const enhanced = unsigned(
        view,
        definition,
        position,
        RECORD_ENHANCED_ALTITUDE,
        4,
      );
      const plain = unsigned(view, definition, position, RECORD_ALTITUDE, 2);
      const raw = enhanced ?? plain;
      into.records.push({
        ...point,
        ele: raw === null ? null : altitudeMeters(raw),
      });
      const time = unsigned(view, definition, position, FIELD_TIMESTAMP, 4);
      if (time !== null) into.timestamps.push(time);
      return;
    }
    case MESSAGE_FILE_ID: {
      const field = definition.fields.find((f) => f.num === 0 && f.size === 1);
      if (field) into.fileType = view.getUint8(position + field.offset);
      return;
    }
    case MESSAGE_COURSE: {
      const field = definition.fields.find(
        (f) => f.num === COURSE_NAME && f.type === 7,
      );
      if (!field) return;
      const start = position + field.offset;
      let end = start;
      while (end < start + field.size && bytes[end] !== 0) end++;
      const text = new TextDecoder().decode(bytes.subarray(start, end)).trim();
      if (text) into.name = text;
      return;
    }
    case MESSAGE_SESSION:
    case MESSAGE_LAP: {
      const ms = unsigned(view, definition, position, TIMER_TIME, 4);
      if (ms === null) return;
      if (definition.global === MESSAGE_SESSION)
        into.sessionSeconds = ms / 1000;
      else into.lapSeconds += ms / 1000;
      return;
    }
  }
}

/**
 * Reads the messages of one FIT file (its header at `start`) into `into`. The structure is the
 * one of the FIT protocol: a header, then definition messages that say how the data messages that
 * follow are laid out (their byte order included), then a CRC. Throws {@link Malformed} when
 * the sizes do not add up.
 */
function readFile(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  headerSize: number,
  dataEnd: number,
  into: Collected,
): void {
  const definitions: (Definition | undefined)[] = new Array(16);
  let position = start + headerSize;

  const data = (local: number): void => {
    const definition = definitions[local];
    if (!definition) throw new Malformed();
    if (position + definition.size > dataEnd) throw new Malformed();
    readMessage(view, bytes, definition, position, into);
    position += definition.size;
  };

  while (position < dataEnd) {
    const header = view.getUint8(position++);
    if (header & 0x80) {
      // A data message with a compressed timestamp: the local type is in bits 5 and 6.
      data((header >> 5) & 0x03);
    } else if (header & 0x40) {
      const hasDeveloperFields = (header & 0x20) !== 0;
      position += 1; // reserved
      const little = view.getUint8(position++) === 0;
      const global = view.getUint16(position, little);
      position += 2;
      const count = view.getUint8(position++);
      const fields: FieldDefinition[] = [];
      let size = 0;
      for (let i = 0; i < count; i++) {
        const num = view.getUint8(position);
        const length = view.getUint8(position + 1);
        const type = view.getUint8(position + 2) & 0x1f;
        position += 3;
        fields.push({ num, size: length, type, offset: size });
        size += length;
      }
      if (hasDeveloperFields) {
        const developer = view.getUint8(position++);
        for (let i = 0; i < developer; i++) {
          size += view.getUint8(position + 1);
          position += 3;
        }
      }
      if (position > dataEnd) throw new Malformed();
      definitions[header & 0x0f] = { global, little, fields, size };
    } else {
      data(header & 0x0f);
    }
  }
}

/**
 * Reads a FIT file: an activity, a course or any file that has records with a position. The track
 * is the sequence of its records, thinned like a GPX track. A FIT file can be several files one
 * after the other: they are read in turn. Everything stays on the device. The file's CRC is not
 * checked (a file with a wrong one is read all the same, each point being checked); a file whose
 * structure does not add up is refused. Throws {@link FitImportError}.
 */
export function parseFit(bytes: Uint8Array, profile: Profile): ImportedRoute {
  if (bytes.length > MAX_FIT_BYTES) throw new FitImportError('too_large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const collected: Collected = {
    fileType: null,
    name: null,
    sessionSeconds: null,
    lapSeconds: 0,
    timestamps: [],
    records: [],
  };

  let offset = 0;
  try {
    while (offset + 12 <= bytes.length) {
      const headerSize = bytes[offset];
      const signature = String.fromCharCode(
        ...bytes.subarray(offset + 8, offset + 12),
      );
      const valid =
        (headerSize === 12 || headerSize === 14) && signature === '.FIT';
      if (!valid) {
        // Something after the last file is not ours to read.
        if (offset === 0) throw new FitImportError('invalid_file');
        break;
      }
      const dataEnd = offset + headerSize + view.getUint32(offset + 4, true);
      if (dataEnd > bytes.length) throw new FitImportError('invalid_file');
      readFile(bytes, view, offset, headerSize, dataEnd, collected);
      offset = dataEnd + 2; // the CRC
    }
    if (offset === 0) throw new FitImportError('invalid_file');
  } catch (error) {
    if (error instanceof FitImportError) throw error;
    // Malformed, or a read past the end of the bytes (RangeError).
    throw new FitImportError('invalid_file');
  }

  const records = collected.records;
  const withAltitude = records.filter((r) => r.ele !== null).length;
  // A few records without altitude (a dropout) take the last known one; a track that mostly lacks
  // it has no climb to speak of.
  const known =
    records.length > 0 && withAltitude / records.length >= MIN_ALTITUDE_SHARE;
  let last: number | null = records.find((r) => r.ele !== null)?.ele ?? null;
  const raw: RawPoint[] = records.map((record) => {
    if (record.ele !== null) last = record.ele;
    return {
      lon: record.lon,
      lat: record.lat,
      ele: known ? last : null,
    };
  });

  const times = collected.timestamps;
  const elapsed = times.length >= 2 ? times[times.length - 1] - times[0] : null;
  return routeFromPoints(raw, {
    name: collected.name,
    profile,
    durationSeconds:
      collected.sessionSeconds ??
      (collected.lapSeconds > 0 ? collected.lapSeconds : elapsed),
    fail: (code) => new FitImportError(code),
  });
}
