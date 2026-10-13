/**
 * PITCH JS fallback measurement engine. Mirrors the math of pdfcraft-measure
 * (storytold/pdfcraft crates/measure + crates/model view_matrix) so both engines
 * must pass the same accuracy and coordinate tests. It cannot read PDF content,
 * so snapping and embedded annotations are reported as unsupported (null).
 */
import type { Kind, MeasureEngine, PageBox, Pt, Reading, Scale } from './types';

const MAX_POINTS = 2048;
const MAX_COORD = 1e9;

function checkPoints(points: Pt[]) {
  if (points.length > MAX_POINTS || points.some((p) => p.some((v) => !Number.isFinite(v) || Math.abs(v) > MAX_COORD))) {
    throw new Error('measurement geometry must be finite, within 1e9 user units, and have at most 2048 vertices');
  }
}
export function validateScale(s: Scale) {
  for (const f of [s.x, s.y]) if (!Number.isFinite(f) || f < 1e-12 || f > 1e12) throw new Error('scale factors must be finite and between 1e-12 and 1e12');
  if (s.precision < 0 || s.precision > 6) throw new Error('precision must be between 0 and 6 decimal places');
}
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function viewMatrix(box: PageBox): number[] {
  const [x0, y0, x1, y1] = box.crop;
  const r = (((Math.trunc(box.rotate) % 360) + 360) % 360 / 90 | 0) * 90;
  const m = r === 90 ? [0, 1, -1, 0, x1, y0] : r === 180 ? [-1, 0, 0, -1, x1, y1] : r === 270 ? [0, -1, 1, 0, x0, y1] : [1, 0, 0, 1, x0, y0];
  const u = box.userUnit >= 1 ? Math.min(box.userUnit, 75000) : 1;
  return u === 1 ? m : [m[0] / u, m[1] / u, m[2] / u, m[3] / u, m[4], m[5]];
}
function displaySize(box: PageBox): [number, number] {
  const [x0, y0, x1, y1] = box.crop;
  const u = box.userUnit >= 1 ? Math.min(box.userUnit, 75000) : 1;
  const w = (x1 - x0) * u, h = (y1 - y0) * u;
  const r = (((Math.trunc(box.rotate) % 360) + 360) % 360 / 90 | 0) * 90;
  return r % 180 === 0 ? [w, h] : [h, w];
}

export const jsEngine: MeasureEngine = {
  id: 'pitch-js',
  version: 'pitch-js-measure@1',
  calibrate(a, b, real, unit, precision = 2) {
    checkPoints([a, b]);
    if (!Number.isFinite(real) || real <= 0) throw new Error('calibration distance must be finite and positive');
    const len = dist(a, b);
    if (len < 1e-6) throw new Error('calibration needs two distinct points');
    const k = real / len;
    const s: Scale = { x: k, y: k, unit, area_unit: `${unit}^2`, precision, ratio: `1 pt = ${k} ${unit}` };
    validateScale(s);
    return s;
  },
  reading(kind: Kind, points: Pt[], s: Scale): Reading {
    checkPoints(points);
    validateScale(s);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      length += Math.hypot((b[0] - a[0]) * s.x, (b[1] - a[1]) * s.y);
    }
    let area = 0;
    if (points.length >= 3) {
      const o = points[0];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        area += ((a[0] - o[0]) * (b[1] - o[1]) - (b[0] - o[0]) * (a[1] - o[1])) * 0.5;
      }
      area = Math.abs(area) * s.x * s.y;
    }
    const value = kind === 'area' ? area : length;
    const unit = kind === 'area' ? s.area_unit : s.unit;
    if (!Number.isFinite(value)) throw new Error('measurement overflows its scale');
    return { kind, value, unit, label: `${value.toFixed(s.precision)} ${unit}`, length, area };
  },
  viewToUser(box, at) {
    checkPoints([at]);
    const [, h] = displaySize(box);
    const m = viewMatrix(box);
    const x = at[0], y = h - at[1];
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  },
  userToView(box, at) {
    checkPoints([at]);
    const [, h] = displaySize(box);
    const [a, b, c, d, e, f] = viewMatrix(box);
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) throw new Error('invalid page transform');
    const px = at[0] - e, py = at[1] - f;
    const x = (d * px - c * py) / det, y = (-b * px + a * py) / det;
    return [x, h - y];
  },
  geometry: () => null,
  embed: () => null,
  listEmbedded: () => null,
};
