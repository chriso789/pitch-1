/**
 * Page-size classification from a detected quadrilateral aspect ratio.
 *
 * Heights/widths are in portrait orientation; we compare detected
 * (longSide/shortSide) against known paper-stock ratios.
 */

export type DetectedPageSize = 'letter' | 'legal' | 'a4' | 'unknown';

export interface PageSizeSpec {
  size: DetectedPageSize;
  /** Width in inches (portrait). */
  widthIn: number;
  /** Height in inches (portrait). */
  heightIn: number;
  /** Output canvas width in px at 300 DPI. */
  outputWidth: number;
  /** Output canvas height in px at 300 DPI. */
  outputHeight: number;
  /** Long/short aspect ratio. */
  aspect: number;
}

const SPECS: Record<Exclude<DetectedPageSize, 'unknown'>, PageSizeSpec> = {
  letter: {
    size: 'letter',
    widthIn: 8.5,
    heightIn: 11,
    outputWidth: 2550,
    outputHeight: 3300,
    aspect: 11 / 8.5,
  },
  legal: {
    size: 'legal',
    widthIn: 8.5,
    heightIn: 14,
    outputWidth: 2550,
    outputHeight: 4200,
    aspect: 14 / 8.5,
  },
  a4: {
    size: 'a4',
    widthIn: 8.27,
    heightIn: 11.69,
    outputWidth: 2480,
    outputHeight: 3508,
    aspect: 297 / 210,
  },
};

const UNKNOWN_SPEC: PageSizeSpec = SPECS.letter;

const TOLERANCE = 0.06; // ~6% match window

export function classifyAspectRatio(longSide: number, shortSide: number): DetectedPageSize {
  if (shortSide <= 0) return 'unknown';
  const ratio = longSide / shortSide;
  let best: DetectedPageSize = 'unknown';
  let bestDelta = Number.POSITIVE_INFINITY;
  (Object.keys(SPECS) as Array<keyof typeof SPECS>).forEach((k) => {
    const delta = Math.abs(ratio - SPECS[k].aspect) / SPECS[k].aspect;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = k;
    }
  });
  return bestDelta <= TOLERANCE ? best : 'unknown';
}

export function getPageSpec(size: DetectedPageSize): PageSizeSpec {
  if (size === 'unknown') return UNKNOWN_SPEC;
  return SPECS[size];
}

/**
 * Pick the dominant page size across pages (mode, falling back to letter).
 */
export function dominantPageSize(sizes: DetectedPageSize[]): DetectedPageSize {
  const counts = new Map<DetectedPageSize, number>();
  sizes.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
  let best: DetectedPageSize = 'letter';
  let bestCount = 0;
  counts.forEach((c, k) => {
    if (k === 'unknown') return;
    if (c > bestCount) {
      bestCount = c;
      best = k;
    }
  });
  return bestCount > 0 ? best : 'letter';
}
