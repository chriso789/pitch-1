/**
 * Patent-aligned slope-factor table per US 9,183,538 B2 (Quick-Square Roof Reporting).
 *
 * Slope Factor = sqrt(1 + (rise/run)^2) where run = 12 (inches per foot).
 *
 * Quick-Square equation (FIG. 7 of US9183538):
 *   roof_area_sqft = footprint_sqft * slope_factor(predominant_pitch)
 *   roofing_squares = roof_area_sqft / 100
 *
 * The values below are taken VERBATIM from the patent's Slope Factor Chart and
 * MUST NOT be altered. They are the canonical source for all area-from-pitch
 * calculations across the measurement system.
 */

export const SLOPE_FACTOR_TABLE: Readonly<Record<number, number>> = Object.freeze({
  1: 1.0035,
  2: 1.0138,
  3: 1.0308,
  4: 1.0541,
  5: 1.0833,
  6: 1.1180,
  7: 1.1577,
  8: 1.2019,
  9: 1.2500,
  10: 1.3017,
  11: 1.3566,
  12: 1.4142,
});

/**
 * Returns the slope factor for a given pitch (rise per 12" of run).
 * For non-integer pitches, linearly interpolates between the two nearest
 * tabulated integer pitches. Pitches < 1 fall back to 1.0035; pitches > 12
 * extrapolate using the analytic formula.
 */
export function slopeFactor(pitch: number): number {
  if (!Number.isFinite(pitch) || pitch <= 0) return 1.0035;
  if (pitch >= 12) return Math.sqrt(1 + (pitch / 12) ** 2);

  const lo = Math.floor(pitch);
  const hi = Math.ceil(pitch);
  if (lo === hi) return SLOPE_FACTOR_TABLE[lo] ?? 1.0035;

  const a = SLOPE_FACTOR_TABLE[lo] ?? 1.0035;
  const b = SLOPE_FACTOR_TABLE[hi] ?? 1.4142;
  const t = pitch - lo;
  return a + (b - a) * t;
}

/**
 * Quick-Square calculation per US9183538 FIG. 7.
 * @param footprintSqft Plan-view (top-down) footprint area in square feet.
 * @param predominantPitch Predominant pitch in rise:12 (e.g. 6 = 6/12).
 */
export function quickSquare(footprintSqft: number, predominantPitch: number) {
  const sf = slopeFactor(predominantPitch);
  const roofAreaSqft = footprintSqft * sf;
  return {
    slope_factor: sf,
    roof_area_sqft: roofAreaSqft,
    roofing_squares: roofAreaSqft / 100,
  };
}
