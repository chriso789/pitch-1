/**
 * Post-warp deskew.
 *
 * After perspective correction the document is rectangular, but residual
 * 1–5° rotation often remains. We estimate the dominant near-horizontal
 * gradient direction and rotate the canvas to compensate, then crop/pad
 * back to the original canvas size so downstream sizing is preserved.
 */

const MAX_DESKEW_DEG = 5;

/**
 * Estimate skew angle in degrees within ±MAX_DESKEW_DEG.
 * Positive angle means the document is rotated clockwise.
 */
export function estimateSkewAngle(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  // Downsample to ~400px wide for speed.
  const targetW = Math.min(400, canvas.width);
  const scale = targetW / canvas.width;
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  if (!tctx) return 0;
  tctx.drawImage(canvas, 0, 0, w, h);
  const { data } = tctx.getImageData(0, 0, w, h);

  // Grayscale.
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = Math.round(
      0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2],
    );
  }

  // Sobel + histogram of near-horizontal edge orientations.
  // Bins span -MAX..+MAX degrees in 0.5° increments.
  const binStep = 0.5;
  const bins = Math.floor((MAX_DESKEW_DEG * 2) / binStep) + 1;
  const hist = new Float32Array(bins);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] +
        -2 * gray[y * w + (x - 1)] +
        2 * gray[y * w + (x + 1)] +
        -gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[(y - 1) * w + x] -
        gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] +
        2 * gray[(y + 1) * w + x] +
        gray[(y + 1) * w + (x + 1)];

      const mag = Math.abs(gx) + Math.abs(gy);
      if (mag < 60) continue;

      // For near-horizontal edges, gy dominates. Skip near-vertical edges.
      if (Math.abs(gx) > Math.abs(gy)) continue;

      // Angle of the edge line (perpendicular to gradient) relative to
      // horizontal: atan(gx/gy) in degrees.
      const angle = (Math.atan2(gx, Math.abs(gy)) * 180) / Math.PI;
      if (Math.abs(angle) > MAX_DESKEW_DEG) continue;
      const bin = Math.round((angle + MAX_DESKEW_DEG) / binStep);
      if (bin >= 0 && bin < bins) hist[bin] += mag;
    }
  }

  // Find dominant bin.
  let bestBin = -1;
  let bestVal = 0;
  for (let i = 0; i < bins; i++) {
    if (hist[i] > bestVal) {
      bestVal = hist[i];
      bestBin = i;
    }
  }
  if (bestBin < 0) return 0;
  // Need a meaningful signal vs the median to act.
  const sorted = Array.from(hist).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  if (bestVal < median * 3) return 0;

  return bestBin * binStep - MAX_DESKEW_DEG;
}

/**
 * Rotate a canvas in-place by the given (small) angle in degrees, keeping
 * the original canvas dimensions. Areas outside become white.
 */
export function rotateCanvas(
  canvas: HTMLCanvasElement,
  angleDeg: number,
): HTMLCanvasElement {
  if (Math.abs(angleDeg) < 0.25) return canvas;
  const w = canvas.width;
  const h = canvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-angleDeg * Math.PI) / 180);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

/**
 * Convenience: estimate + rotate, returning {canvas, angle}.
 */
export function deskewCanvas(canvas: HTMLCanvasElement): {
  canvas: HTMLCanvasElement;
  angle: number;
} {
  const angle = estimateSkewAngle(canvas);
  const rotated = rotateCanvas(canvas, angle);
  return { canvas: rotated, angle };
}
