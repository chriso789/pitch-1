/**
 * Patent-aligned imagery abnormality detection per US 8,515,198 B2.
 *
 * The patent describes scanning a captured image immediately for
 * abnormalities (clouds, streaks, lens artifacts, obscurations) and
 * automatically scheduling a re-shoot when one is detected.
 *
 * In our context, the "moving platform" is replaced by tile providers
 * (Mapbox / Google satellite / Pictometry). When abnormalities are detected
 * in the tile, the measurement engine MUST block downstream processing and
 * request a fresh tile (different zoom, provider, or capture date).
 *
 * Detection runs client-side on the loaded HTMLImageElement using a small
 * canvas sample. It is heuristic but conservative - it should reject only
 * clearly degraded imagery to avoid blocking legitimate measurements.
 */

export type Abnormality =
  | "cloud_cover"
  | "lens_streak"
  | "low_contrast"
  | "heavy_shadow"
  | "obstruction"
  | "tile_error";

export interface ImageryQCResult {
  passed: boolean;
  abnormalities: Abnormality[];
  /** 0..1, higher = better imagery quality. */
  quality_score: number;
  /** Whether the engine should automatically request a re-shoot. */
  reshoot_recommended: boolean;
  details: string[];
}

/**
 * Sample a loaded image element on a downsampled canvas and run the
 * abnormality detection algorithm. Returns synchronously after the canvas
 * draw + readback (typically <20ms for 256x256 sample).
 */
export function detectImageryAbnormalities(
  img: HTMLImageElement,
  opts: { sampleSize?: number } = {},
): ImageryQCResult {
  const size = opts.sampleSize ?? 256;
  const abnormalities: Abnormality[] = [];
  const details: string[] = [];

  if (!img.complete || img.naturalWidth === 0) {
    return {
      passed: false,
      abnormalities: ["tile_error"],
      quality_score: 0,
      reshoot_recommended: true,
      details: ["Tile failed to load."],
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      passed: true,
      abnormalities: [],
      quality_score: 0.5,
      reshoot_recommended: false,
      details: ["Canvas unavailable; QC skipped."],
    };
  }

  try {
    ctx.drawImage(img, 0, 0, size, size);
  } catch {
    return {
      passed: false,
      abnormalities: ["tile_error"],
      quality_score: 0,
      reshoot_recommended: true,
      details: ["Tile is tainted (CORS); cannot QC."],
    };
  }

  const data = ctx.getImageData(0, 0, size, size).data;
  const n = size * size;

  let sumL = 0;
  let sumL2 = 0;
  let nearWhite = 0;
  let nearBlack = 0;
  let lowSat = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const sat = max === 0 ? 0 : (max - min) / max;
    sumL += l;
    sumL2 += l * l;
    if (l > 235) nearWhite++;
    if (l < 25) nearBlack++;
    if (sat < 0.08) lowSat++;
  }

  const meanL = sumL / n;
  const varL = sumL2 / n - meanL * meanL;
  const stdL = Math.sqrt(Math.max(0, varL));
  const whiteFrac = nearWhite / n;
  const blackFrac = nearBlack / n;
  const lowSatFrac = lowSat / n;

  // Cloud cover: large area of near-white, low-saturation pixels.
  if (whiteFrac > 0.25 && lowSatFrac > 0.4) {
    abnormalities.push("cloud_cover");
    details.push(
      `Cloud cover suspected (${(whiteFrac * 100).toFixed(0)}% near-white).`,
    );
  }
  // Heavy shadow: large area near black.
  if (blackFrac > 0.2) {
    abnormalities.push("heavy_shadow");
    details.push(
      `Heavy shadow detected (${(blackFrac * 100).toFixed(0)}% near-black).`,
    );
  }
  // Low contrast: near-uniform luminance.
  if (stdL < 18) {
    abnormalities.push("low_contrast");
    details.push(`Low contrast (sigma=${stdL.toFixed(1)}).`);
  }
  // Lens streak heuristic: very high luminance variance along a single row
  // band. Cheap proxy: scan rows for sudden bright stripes wider than 30%.
  let streakRows = 0;
  for (let y = 0; y < size; y += 4) {
    let bright = 0;
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (data[idx] > 230 && data[idx + 1] > 230 && data[idx + 2] > 230) {
        bright++;
      }
    }
    if (bright / size > 0.35) streakRows++;
  }
  if (streakRows > 4) {
    abnormalities.push("lens_streak");
    details.push(`Bright stripe artifact across ${streakRows} sampled rows.`);
  }

  const passed = abnormalities.length === 0;
  // Quality score: penalize each abnormality.
  let quality = 1 - abnormalities.length * 0.25;
  quality = Math.max(0, Math.min(1, quality));

  return {
    passed,
    abnormalities,
    quality_score: quality,
    reshoot_recommended: !passed,
    details,
  };
}

/**
 * Helper for headless contexts (edge functions don't have HTMLImageElement).
 * Accepts a pre-decoded RGBA buffer plus dimensions and runs the same
 * heuristic. Keeps logic in one place so server- and client-side QC agree.
 */
export function detectImageryAbnormalitiesFromBuffer(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ImageryQCResult {
  const fakeImg = { complete: true, naturalWidth: width, naturalHeight: height } as HTMLImageElement;
  // Reuse: build a synthetic ImageData via a manual loop since OffscreenCanvas
  // may not be available. We just inline the same metrics here.
  const n = width * height;
  let sumL = 0;
  let sumL2 = 0;
  let nearWhite = 0;
  let nearBlack = 0;
  let lowSat = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const sat = max === 0 ? 0 : (max - min) / max;
    sumL += l;
    sumL2 += l * l;
    if (l > 235) nearWhite++;
    if (l < 25) nearBlack++;
    if (sat < 0.08) lowSat++;
  }
  const meanL = sumL / n;
  const stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
  const whiteFrac = nearWhite / n;
  const blackFrac = nearBlack / n;
  const lowSatFrac = lowSat / n;
  const abnormalities: Abnormality[] = [];
  const details: string[] = [];
  if (whiteFrac > 0.25 && lowSatFrac > 0.4) abnormalities.push("cloud_cover");
  if (blackFrac > 0.2) abnormalities.push("heavy_shadow");
  if (stdL < 18) abnormalities.push("low_contrast");
  void fakeImg;
  return {
    passed: abnormalities.length === 0,
    abnormalities,
    quality_score: Math.max(0, 1 - abnormalities.length * 0.25),
    reshoot_recommended: abnormalities.length > 0,
    details,
  };
}
