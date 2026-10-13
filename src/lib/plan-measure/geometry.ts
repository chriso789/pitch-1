import type { Pt, Scale, VectorGeometry } from './types';

export type SnapHit = { point: Pt; kind: 'endpoint' | 'midpoint' | 'path'; distance: number };

/** Snap a user-space point to vector geometry within `tol` user units. Priority: endpoint > midpoint > path. */
export function snapToGeometry(g: VectorGeometry | null, at: Pt, tol: number): SnapHit | null {
  if (!g) return null;
  const near = (list: Pt[], kind: SnapHit['kind']) => {
    let best: SnapHit | null = null;
    for (const p of list) {
      const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (d <= tol && (!best || d < best.distance)) best = { point: [p[0], p[1]], kind, distance: d };
    }
    return best;
  };
  const e = near(g.endpoints, 'endpoint'); if (e) return e;
  const m = near(g.midpoints, 'midpoint'); if (m) return m;
  let best: SnapHit | null = null;
  for (const [a, b] of g.segments) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / l2));
    const p: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d <= tol && (!best || d < best.distance)) best = { point: p, kind: 'path', distance: d };
  }
  return best;
}

/** Slope factor for a pitch of `rise` in 12. Plan area x factor = sloped roof area. */
export const pitchFactor = (rise: number) => Math.sqrt(1 + (rise / 12) ** 2);

/** Scale from a stated drawing ratio, e.g. 1/8" = 1'-0": paperInches=0.125, realUnits=1 (ft). */
export function scaleFromRatio(paperInches: number, realUnits: number, unit: string, userUnit = 1, precision = 2): Scale {
  if (!(paperInches > 0) || !(realUnits > 0)) throw new Error('Drawing scale values must be positive');
  const perUserUnit = ((userUnit >= 1 ? userUnit : 1) / 72) * (realUnits / paperInches);
  return { x: perUserUnit, y: perUserUnit, unit, area_unit: `${unit}^2`, precision, ratio: `${paperInches} in = ${realUnits} ${unit}` };
}

/** Verification: |measured - expected| / expected. Pass at <= 1%. */
export const VERIFY_TOLERANCE = 0.01;
export function verifyError(measured: number, expected: number) {
  if (!(expected > 0)) throw new Error('Expected dimension must be positive');
  return Math.abs(measured - expected) / expected;
}

/** Parses 12'-6", 12' 6", 12.5, 12ft, 150in into feet. Returns NaN when unreadable. */
export function parseFeet(s: string): number {
  const t = s.trim().toLowerCase().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)$/);
  if (m) return Number(m[1]) / 12;
  m = t.match(/^\d+(?:\.\d+)?$/);
  return m ? Number(t) : NaN;
}
