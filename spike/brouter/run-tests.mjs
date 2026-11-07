#!/usr/bin/env node
// BRouter spike: calls the local BRouter HTTP API for each test case,
// stores raw responses in results/ and a metrics summary in results/summary.json.
// Usage: node run-tests.mjs [baseUrl]   (default http://localhost:17777)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';

const BASE = process.argv[2] ?? process.env.BROUTER_URL ?? 'http://localhost:17777';
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Test places (lon,lat), all inside segment E0_N45 (lon 0..5, lat 45..50).
const P = {
  clermont: [3.087, 45.777],
  billom: [3.342, 45.722],
  issoire: [3.249, 45.544],
  vichy: [3.426, 46.128],
  roanne: [4.069, 46.034],
  thiers: [3.548, 45.856],
};
const ll = (...pts) => pts.map((p) => p.join(',')).join('|');

const results = [];
const note = (id, data) => {
  results.push({ id, ...data });
  console.log(id, JSON.stringify(data));
};

async function route({ id, points, profile, alt = 0, format = 'geojson', extra = '' }) {
  const url = `${BASE}/brouter?lonlats=${ll(...points)}&profile=${profile}&alternativeidx=${alt}&format=${format}${extra}`;
  const t0 = Date.now();
  const res = await fetch(url);
  const body = await res.text();
  const ms = Date.now() - t0;
  const ext = format === 'gpx' ? 'gpx' : 'geojson';
  writeFileSync(`${OUT}${id}.${ext}`, body);
  return { ok: res.ok, status: res.status, ms, body, url };
}

const haversine = ([lon1, lat1], [lon2, lat2]) => {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett', 'cobblestone', 'metal']);
const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'compacted', 'ground', 'dirt', 'earth', 'grass', 'sand', 'mud', 'pebblestone', 'rock', 'wood', 'grass_paver']);
const ROAD = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link', 'motorway_link']);

/** Summarise a BRouter GeoJSON response: distance, ascent, time, surface shares. */
function summarise(geojson) {
  const f = geojson.features[0];
  const p = f.properties;
  const out = {
    distanceKm: +(Number(p['track-length']) / 1000).toFixed(1),
    ascentM: Number(p['filtered ascend']),
    timeMin: +(Number(p['total-time']) / 60).toFixed(0),
    points: f.geometry.coordinates.length,
  };
  const msgs = p.messages;
  if (Array.isArray(msgs) && msgs.length > 1) {
    const h = msgs[0];
    const iD = h.indexOf('Distance'), iT = h.indexOf('WayTags');
    const b = { paved: 0, unpaved: 0, pathUnknown: 0, roadUnknown: 0, other: 0 };
    let total = 0;
    for (const row of msgs.slice(1)) {
      const d = Number(row[iD]);
      const tags = Object.fromEntries(String(row[iT]).split(' ').filter(Boolean).map((kv) => kv.split('=')));
      const surf = tags.surface, hw = tags.highway;
      total += d;
      if (PAVED.has(surf)) b.paved += d;
      else if (UNPAVED.has(surf)) b.unpaved += d;
      else if (!surf && ROAD.has(hw)) b.roadUnknown += d;
      else if (!surf && ['track', 'path', 'footway', 'bridleway', 'cycleway', 'steps', 'pedestrian'].includes(hw)) b.pathUnknown += d;
      else b.other += d;
    }
    const pct = (v) => +((100 * v) / total).toFixed(1);
    out.surfacePct = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, pct(v)]));
  }
  return out;
}

const coords = (g) => g.features[0].geometry.coordinates;

// ---- (a) three profiles, 30-50 km: Clermont -> Billom -> Issoire ----
const tripA = [P.clermont, P.billom, P.issoire];
const baseline = {};
for (const profile of ['trekking', 'fastbike', 'fastbike-verylowtraffic']) {
  const r = await route({ id: `a_${profile}`, points: [P.clermont, P.issoire], profile });
  if (!r.ok) { note(`a_${profile}`, { error: r.body.slice(0, 200) }); continue; }
  const g = JSON.parse(r.body);
  baseline[profile] = g;
  note(`a_${profile}`, { ms: r.ms, ...summarise(g) });
}

// ---- (b) alternatives 0..3 (trekking, same trip) ----
const alts = [];
for (let alt = 0; alt <= 3; alt++) {
  const r = await route({ id: `b_alt${alt}`, points: [P.clermont, P.issoire], profile: 'trekking', alt });
  if (!r.ok) { note(`b_alt${alt}`, { status: r.status, error: r.body.slice(0, 120) }); continue; }
  const g = JSON.parse(r.body);
  alts.push({ alt, g });
  note(`b_alt${alt}`, { ms: r.ms, ...summarise(g) });
}
// share of alternative i's points lying within 30 m of alternative 0
const near = (c, line) => line.some((q) => haversine(c, q) < 30);
for (const { alt, g } of alts.slice(1)) {
  const ref = coords(alts[0].g), c = coords(g);
  const shared = c.filter((pt) => near(pt, ref)).length / c.length;
  note(`b_alt${alt}_overlap`, { sharedWithAlt0Pct: +(100 * shared).toFixed(1) });
}

// ---- (c) nogos on a segment used by the trekking route ----
const base = baseline.trekking;
const bc = coords(base);
const mid = bc[Math.floor(bc.length / 2)];
const [mlon, mlat] = mid;
const d = 0.003; // about 330 m east-west, 330 m north-south

function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const segInter = (a, b, c2, d2) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c2) * o(a, b, d2) < 0 && o(c2, d2, a) * o(c2, d2, b) < 0;
};

const cases = {
  circle: { extra: `&nogos=${mlon},${mlat},200`, check: (c) => c.every((q) => haversine(q, mid) > 200) },
  polyline: {
    // a line crossing the original route at its midpoint
    line: [[mlon - d, mlat - d], [mlon + d, mlat + d]],
    get extra() { return `&polylines=${this.line.map((p) => p.join(',')).join(',')}`; },
    check(c) { for (let i = 1; i < c.length; i++) if (segInter(c[i - 1], c[i], this.line[0], this.line[1])) return false; return true; },
  },
  polygon: {
    poly: [[mlon - d, mlat - d], [mlon + d, mlat - d], [mlon + d, mlat + d], [mlon - d, mlat + d]],
    get extra() { return `&polygons=${this.poly.map((p) => p.join(',')).join(',')}`; },
    check(c) { return c.every((q) => !inPoly(q, this.poly)); },
  },
};
note('c_original', { midpoint: mid, originalCrossesCircle: true, ...summarise(base) });
for (const [name, cs] of Object.entries(cases)) {
  const r = await route({ id: `c_${name}`, points: [P.clermont, P.issoire], profile: 'trekking', extra: cs.extra });
  if (!r.ok) { note(`c_${name}`, { status: r.status, error: r.body.slice(0, 200) }); continue; }
  const g = JSON.parse(r.body);
  const c = coords(g);
  const sameAsOriginal = JSON.stringify(c) === JSON.stringify(bc);
  note(`c_${name}`, { ms: r.ms, avoided: cs.check(c), identicalToOriginal: sameAsOriginal, ...summarise(g) });
}

// control: a polygon far from the route must leave the route unchanged
{
  const far = [[3.6, 45.9], [3.62, 45.9], [3.62, 45.92], [3.6, 45.92]];
  const r = await route({ id: 'c_control_far_polygon', points: [P.clermont, P.issoire], profile: 'trekking', extra: `&polygons=${far.map((p) => p.join(',')).join(',')}` });
  const same = r.ok && JSON.stringify(coords(JSON.parse(r.body))) === JSON.stringify(bc);
  note('c_control_far_polygon', { identicalToOriginal: same });
}

// ---- (d) intermediate waypoint ----
{
  const r = await route({ id: 'd_via', points: tripA, profile: 'trekking' });
  if (r.ok) {
    const g = JSON.parse(r.body);
    const viaDist = Math.min(...coords(g).map((q) => haversine(q, P.billom)));
    note('d_via', { ms: r.ms, closestPointToViaM: Math.round(viaDist), ...summarise(g) });
  } else note('d_via', { error: r.body.slice(0, 200) });
}

// ---- (e) GPX export ----
{
  const r = await route({ id: 'e_gpx', points: tripA, profile: 'trekking', format: 'gpx' });
  const trkpts = (r.body.match(/<trkpt /g) ?? []).length;
  const ele = (r.body.match(/<ele>/g) ?? []).length;
  note('e_gpx', { ok: r.ok, ms: r.ms, bytes: r.body.length, trkpts, trkptsWithEle: ele, head: r.body.slice(0, 200).replace(/\s+/g, ' ') });
}

// ---- (f) long trips, with docker stats sampled during the request ----
// f_150km: Clermont -> Vichy -> Roanne (about 148 km). f_260km: full loop via Thiers (extreme case).
for (const [fid, longTrip] of [
  ['f_150km', [P.clermont, P.vichy, P.roanne]],
  ['f_260km', [P.clermont, P.vichy, P.roanne, P.thiers, P.clermont]],
]) {
  let peak = 0;
  // async sampling: a blocking execSync would starve the event loop and inflate response times
  const sample = () => new Promise((resolve) => {
    exec(`docker stats brouter --no-stream --format '{{.MemUsage}}'`, (err, o) => {
      if (!err) {
        const m = o.trim().split('/')[0].trim();
        const v = parseFloat(m) * (m.includes('GiB') ? 1024 : m.includes('KiB') ? 1 / 1024 : 1);
        peak = Math.max(peak, v);
      }
      resolve();
    });
  });
  const timer = setInterval(() => { sample(); }, 1000);
  const r = await route({ id: fid, points: longTrip, profile: 'trekking' });
  clearInterval(timer);
  await sample();
  if (r.ok) note(fid, { ms: r.ms, peakMemMiB: Math.round(peak), ...summarise(JSON.parse(r.body)) });
  else note(fid, { status: r.status, ms: r.ms, peakMemMiB: Math.round(peak), error: r.body.slice(0, 200) });
}

writeFileSync(`${OUT}summary.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}summary.json`);
