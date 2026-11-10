import { gpxFileName } from '@voie-libre/shared';
import type { LngLat } from '../core/map/map-factory';
import { haversine } from '../planner/elevation-profile';
import { pointVertices } from '../planner/insert-point';
import type { LngLat3 } from '../planner/planner-map-driver';

/** The parts of a route a FIT course file is built from. */
export interface FitSource {
  name: string;
  /** Decides the sport of the course: running for `trail`, cycling otherwise. */
  profile: string;
  /** `[longitude, latitude]` of the start, the stops and the end. */
  points: readonly LngLat[];
  /** `[longitude, latitude, elevation in meters]` per point of the itinerary. */
  geometry: readonly LngLat3[];
  /** Milliseconds since the epoch. */
  createdAt: number;
  distanceMeters: number;
  /** `null` when the elevations are unknown: no altitude and no climb are written. */
  ascentMeters: number | null;
  durationSeconds: number;
}

/** FIT counts seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH_SECONDS = 631_065_600;

/** Base types of the FIT protocol: their code in a definition, and their size in bytes. */
const TYPES = {
  enum: { code: 0x00, size: 1 },
  uint8: { code: 0x02, size: 1 },
  uint16: { code: 0x84, size: 2 },
  sint32: { code: 0x85, size: 4 },
  uint32: { code: 0x86, size: 4 },
  uint32z: { code: 0x8c, size: 4 },
  string: { code: 0x07, size: 1 },
} as const;

type FieldType = keyof typeof TYPES;

/** A field of a message: its number in the FIT profile, its type, and its size for a string. */
interface Field {
  num: number;
  type: FieldType;
  /** Bytes of a string field, the final zero included. */
  size?: number;
}

/** A message of the FIT profile, as written in this file. */
interface Message {
  /** Global message number of the FIT profile. */
  global: number;
  fields: readonly Field[];
}

const FILE_ID: Message = {
  global: 0,
  fields: [
    { num: 0, type: 'enum' }, // type
    { num: 1, type: 'uint16' }, // manufacturer
    { num: 2, type: 'uint16' }, // product
    { num: 3, type: 'uint32z' }, // serial number
    { num: 4, type: 'uint32' }, // time created
  ],
};

const COURSE_NAME_BYTES = 48;
const COURSE: Message = {
  global: 31,
  fields: [
    { num: 4, type: 'enum' }, // sport
    { num: 5, type: 'string', size: COURSE_NAME_BYTES }, // name
  ],
};

const LAP: Message = {
  global: 19,
  fields: [
    { num: 253, type: 'uint32' }, // timestamp
    { num: 2, type: 'uint32' }, // start time
    { num: 3, type: 'sint32' }, // start latitude
    { num: 4, type: 'sint32' }, // start longitude
    { num: 5, type: 'sint32' }, // end latitude
    { num: 6, type: 'sint32' }, // end longitude
    { num: 7, type: 'uint32' }, // total elapsed time, in ms
    { num: 8, type: 'uint32' }, // total timer time, in ms
    { num: 9, type: 'uint32' }, // total distance, in cm
    { num: 21, type: 'uint16' }, // total ascent, in m
  ],
};

const EVENT: Message = {
  global: 21,
  fields: [
    { num: 253, type: 'uint32' }, // timestamp
    { num: 0, type: 'enum' }, // event
    { num: 1, type: 'enum' }, // event type
    { num: 4, type: 'uint8' }, // event group
  ],
};

const RECORD_FIELDS: readonly Field[] = [
  { num: 253, type: 'uint32' }, // timestamp
  { num: 0, type: 'sint32' }, // latitude
  { num: 1, type: 'sint32' }, // longitude
  { num: 5, type: 'uint32' }, // distance, in cm
];
const RECORD: Message = { global: 20, fields: RECORD_FIELDS };
const RECORD_WITH_ALTITUDE: Message = {
  global: 20,
  // Altitude: (meters + 500) × 5.
  fields: [...RECORD_FIELDS, { num: 2, type: 'uint16' }],
};

const POINT_NAME_BYTES = 32;
const COURSE_POINT: Message = {
  global: 32,
  fields: [
    { num: 254, type: 'uint16' }, // message index
    { num: 1, type: 'uint32' }, // timestamp
    { num: 2, type: 'sint32' }, // latitude
    { num: 3, type: 'sint32' }, // longitude
    { num: 4, type: 'uint32' }, // distance, in cm
    { num: 5, type: 'enum' }, // type
    { num: 6, type: 'string', size: POINT_NAME_BYTES }, // name
  ],
};

const FILE_TYPE_COURSE = 6;
const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_RUNNING = 1;
const SPORT_CYCLING = 2;
const EVENT_TIMER = 0;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP_ALL = 4;
const COURSE_POINT_GENERIC = 0;
const UINT16_INVALID = 0xffff;

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001,
  0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

/** The CRC-16 of the FIT protocol over `bytes`. */
export function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

/** Degrees as the FIT "semicircles": 2³¹ for 180°. */
function semicircles(degrees: number): number {
  return Math.round((degrees * 2 ** 31) / 180);
}

/**
 * `text` as UTF-8 in exactly `size` bytes, ending with a zero: cut between two characters when it
 * is too long, filled with zeros when it is shorter.
 */
function fixedString(text: string, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const encoder = new TextEncoder();
  let length = 0;
  for (const char of text) {
    const encoded = encoder.encode(char);
    if (length + encoded.length > size - 1) break;
    bytes.set(encoded, length);
    length += encoded.length;
  }
  return bytes;
}

/** Collects the bytes of the messages; each message type is defined once, before its first use. */
class Writer {
  private readonly bytes: number[] = [];
  private readonly defined = new Map<Message, number>();

  write(message: Message, values: readonly (number | string)[]): void {
    let local = this.defined.get(message);
    if (local === undefined) {
      local = this.defined.size;
      this.defined.set(message, local);
      this.define(message, local);
    }
    this.bytes.push(local);
    message.fields.forEach((field, i) => {
      const value = values[i];
      if (field.type === 'string') {
        this.bytes.push(...fixedString(String(value), field.size ?? 1));
      } else {
        this.number(Number(value), TYPES[field.type].size);
      }
    });
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  private define(message: Message, local: number): void {
    // Definition header, a reserved byte, then 0 for little endian.
    this.bytes.push(0x40 | local, 0, 0);
    this.number(message.global, 2);
    this.bytes.push(message.fields.length);
    for (const field of message.fields) {
      const type = TYPES[field.type];
      this.bytes.push(field.num, field.size ?? type.size, type.code);
    }
  }

  /** `value` on `size` bytes, little endian; a negative value in two's complement. */
  private number(value: number, size: number): void {
    let rest = value < 0 ? value + 2 ** (8 * size) : value;
    for (let i = 0; i < size; i++) {
      this.bytes.push(rest % 256);
      rest = Math.floor(rest / 256);
    }
  }
}

/**
 * A FIT course file: the route as a course a bike computer or a watch can follow. One lap, one
 * record per point of the itinerary and one course point per stop, named by `stopNames` (already
 * translated, one per stop, in order). Built on the device from the stored route.
 *
 * A course needs a time on every record: they are made up from the estimated duration, spread
 * along the distance, starting when the route was created.
 */
export function buildFit(
  route: FitSource,
  stopNames: readonly string[] = [],
): Uint8Array<ArrayBuffer> {
  const { geometry } = route;
  if (geometry.length < 2) throw new Error('A course needs two points');

  // Distance of each vertex, scaled so that the last one is the distance of the route.
  const along = [0];
  for (let i = 1; i < geometry.length; i++) {
    along.push(along[i - 1] + haversine(geometry[i - 1], geometry[i]));
  }
  const measured = along[along.length - 1] || 1;
  const distanceCm = (i: number) =>
    Math.round((along[i] / measured) * route.distanceMeters * 100);
  const start = Math.round(route.createdAt / 1000) - FIT_EPOCH_SECONDS;
  const duration = Math.max(1, Math.round(route.durationSeconds));
  const timeAt = (i: number) =>
    start + Math.round((along[i] / measured) * duration);
  const end = start + duration;
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  const withAltitude = route.ascentMeters !== null;

  const writer = new Writer();
  writer.write(FILE_ID, [
    FILE_TYPE_COURSE,
    MANUFACTURER_DEVELOPMENT,
    0,
    // Any number but zero: devices tell courses apart by serial number and creation time.
    (start % 0xfffffffe) + 1,
    start,
  ]);
  writer.write(COURSE, [
    route.profile === 'trail' ? SPORT_RUNNING : SPORT_CYCLING,
    route.name,
  ]);
  writer.write(LAP, [
    end,
    start,
    semicircles(first[1]),
    semicircles(first[0]),
    semicircles(last[1]),
    semicircles(last[0]),
    duration * 1000,
    duration * 1000,
    Math.round(route.distanceMeters * 100),
    route.ascentMeters === null
      ? UINT16_INVALID
      : Math.min(UINT16_INVALID - 1, Math.round(route.ascentMeters)),
  ]);
  writer.write(EVENT, [start, EVENT_TIMER, EVENT_TYPE_START, 0]);
  geometry.forEach(([lon, lat, elevation], i) => {
    const values = [
      timeAt(i),
      semicircles(lat),
      semicircles(lon),
      distanceCm(i),
    ];
    if (withAltitude) {
      const altitude = Math.round((elevation + 500) * 5);
      writer.write(RECORD_WITH_ALTITUDE, [
        ...values,
        Math.max(0, Math.min(UINT16_INVALID - 1, altitude)),
      ]);
    } else {
      writer.write(RECORD, values);
    }
  });
  const vertices = pointVertices(geometry, route.points);
  route.points.slice(1, -1).forEach((_, stop) => {
    const vertex = vertices[stop + 1];
    writer.write(COURSE_POINT, [
      stop,
      timeAt(vertex),
      semicircles(geometry[vertex][1]),
      semicircles(geometry[vertex][0]),
      distanceCm(vertex),
      COURSE_POINT_GENERIC,
      stopNames[stop] ?? '',
    ]);
  });
  writer.write(EVENT, [end, EVENT_TIMER, EVENT_TYPE_STOP_ALL, 0]);

  const data = writer.toBytes();
  const file = new Uint8Array(14 + data.length + 2);
  const view = new DataView(file.buffer);
  file[0] = 14; // header size
  file[1] = 0x10; // protocol version 1.0
  view.setUint16(2, 2132, true); // profile version 21.32
  view.setUint32(4, data.length, true);
  file.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
  view.setUint16(12, fitCrc(file.subarray(0, 12)), true);
  file.set(data, 14);
  view.setUint16(
    14 + data.length,
    fitCrc(file.subarray(0, 14 + data.length)),
    true,
  );
  return file;
}

/** `Col de la Ventouse` becomes `col-de-la-ventouse.fit`. */
export function fitFileName(name: string): string {
  return gpxFileName(name).replace(/\.gpx$/, '.fit');
}
