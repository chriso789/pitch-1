/**
 * Document capture quality analysis
 *
 * Lightweight, pure-canvas heuristics that run alongside edge detection to
 * detect glare, shadow, low light, and blur before we commit to auto-capture.
 *
 * Designed to operate on a downsampled ImageData (same one the detector uses)
 * so it stays cheap on mobile.
 */

export interface QualityFlags {
  glare_detected: boolean;
  shadow_detected: boolean;
  low_light_detected: boolean;
  /** Variance of Laplacian. Higher = sharper. <50 typically blurry. */
  blur_score: number;
  /** 0..1 — fraction of overexposed pixels. */
  overexposed_ratio: number;
  /** 0..1 — fraction of underexposed pixels. */
  underexposed_ratio: number;
  /** Average luma. */
  mean_brightness: number;
}

export interface QualityGateResult {
  flags: QualityFlags;
  /** Hard block: do not allow auto-capture. */
  block: boolean;
  /** Soft warn: allow manual capture but show notice. */
  warn: boolean;
  /** User-facing reason for current status, or null when clean. */
  message: string | null;
  /** "ok" | "warn" | "block" — drives UI color. */
  level: 'ok' | 'warn' | 'block';
}

const OVEREXPOSED_THRESHOLD = 248;
const UNDEREXPOSED_THRESHOLD = 28;

// Tunables — kept conservative so we don't false-positive on white paper.
const GLARE_BLOCK_RATIO = 0.04; // 4%+ blown-out pixels = glare block
const SHADOW_WARN_RATIO = 0.18; // 18%+ very-dark pixels = shadow warn
const LOW_LIGHT_MEAN = 75;
const BLUR_BLOCK_SCORE = 35;

/**
 * Compute quality metrics from a (downsampled) RGBA ImageData.
 */
export function analyzeFrameQuality(imageData: ImageData): QualityFlags {
  const { width, height, data } = imageData;
  const total = width * height;

  // Single pass: grayscale + histogram counts.
  const gray = new Uint8ClampedArray(total);
  let over = 0;
  let under = 0;
  let sum = 0;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const g = Math.round(
      0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2],
    );
    gray[i] = g;
    sum += g;
    if (g >= OVEREXPOSED_THRESHOLD) over++;
    else if (g <= UNDEREXPOSED_THRESHOLD) under++;
  }

  const overexposed_ratio = over / total;
  const underexposed_ratio = under / total;
  const mean_brightness = sum / total;

  // Variance of Laplacian as blur proxy. 3x3 Laplacian on a strided sample
  // (every other pixel) to keep this cheap on large frames.
  let lapSum = 0;
  let lapSumSq = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const c = gray[y * width + x];
      const l =
        4 * c -
        gray[(y - 1) * width + x] -
        gray[(y + 1) * width + x] -
        gray[y * width + (x - 1)] -
        gray[y * width + (x + 1)];
      lapSum += l;
      lapSumSq += l * l;
      lapCount++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapCount);
  const blur_score = Math.max(
    0,
    lapSumSq / Math.max(1, lapCount) - lapMean * lapMean,
  );

  return {
    glare_detected: overexposed_ratio >= GLARE_BLOCK_RATIO,
    shadow_detected: underexposed_ratio >= SHADOW_WARN_RATIO,
    low_light_detected: mean_brightness < LOW_LIGHT_MEAN,
    blur_score,
    overexposed_ratio,
    underexposed_ratio,
    mean_brightness,
  };
}

/**
 * Apply the capture quality gate. Blocks on glare or hard blur; warns on
 * shadow / low light.
 */
export function evaluateQualityGate(flags: QualityFlags): QualityGateResult {
  if (flags.glare_detected) {
    return {
      flags,
      block: true,
      warn: false,
      message: 'Glare detected. Tilt the phone or move away from direct light.',
      level: 'block',
    };
  }
  if (flags.blur_score < BLUR_BLOCK_SCORE) {
    return {
      flags,
      block: true,
      warn: false,
      message: 'Image looks blurry. Hold the phone steady.',
      level: 'block',
    };
  }
  if (flags.low_light_detected) {
    return {
      flags,
      block: false,
      warn: true,
      message: 'Low light detected. Try the torch or more lighting.',
      level: 'warn',
    };
  }
  if (flags.shadow_detected) {
    return {
      flags,
      block: false,
      warn: true,
      message: 'Heavy shadow detected. Scan may be less clear.',
      level: 'warn',
    };
  }
  return { flags, block: false, warn: false, message: null, level: 'ok' };
}
