export interface SvgPoint {
  x: number;
  y: number;
}

export interface SvgLineSegment {
  start: SvgPoint;
  end: SvgPoint;
  length: number;
  gpsStart?: { lat: number; lng: number };
  gpsEnd?: { lat: number; lng: number };
}

export interface ImagePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AutoFitEasternEaveOptions {
  canvasWidth: number;
  canvasHeight: number;
  eaveSegments: SvgLineSegment[];
  imagePlacement: ImagePlacement;
  imageUrl: string;
  inwardSearchPx?: number;
  outwardSearchPx?: number;
  sampleGapPx?: number;
}

interface LocalFit {
  baseScore: number;
  bestOffset: number;
  bestScore: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getPixelIndex(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

function sampleRgb(imageData: ImageData, x: number, y: number) {
  const { data, width, height } = imageData;
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = safeX - x0;
  const fy = safeY - y0;

  const read = (px: number, py: number) => {
    const idx = getPixelIndex(width, px, py);
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
    };
  };

  const c00 = read(x0, y0);
  const c10 = read(x1, y0);
  const c01 = read(x0, y1);
  const c11 = read(x1, y1);

  const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  const top = {
    r: mix(c00.r, c10.r, fx),
    g: mix(c00.g, c10.g, fx),
    b: mix(c00.b, c10.b, fx),
  };
  const bottom = {
    r: mix(c01.r, c11.r, fx),
    g: mix(c01.g, c11.g, fx),
    b: mix(c01.b, c11.b, fx),
  };

  return {
    r: mix(top.r, bottom.r, fy),
    g: mix(top.g, bottom.g, fy),
    b: mix(top.b, bottom.b, fy),
  };
}

function colorContrast(imageData: ImageData, point: SvgPoint, normal: SvgPoint, gap: number) {
  const sampleA = sampleRgb(imageData, point.x + normal.x * gap, point.y + normal.y * gap);
  const sampleB = sampleRgb(imageData, point.x - normal.x * gap, point.y - normal.y * gap);

  return (
    Math.abs(sampleA.r - sampleB.r) +
    Math.abs(sampleA.g - sampleB.g) +
    Math.abs(sampleA.b - sampleB.b)
  );
}

function scoreOffset(
  imageData: ImageData,
  segment: SvgLineSegment,
  inwardNormal: SvgPoint,
  t: number,
  offset: number,
  sampleGapPx: number
) {
  const point = {
    x: segment.start.x + (segment.end.x - segment.start.x) * t + inwardNormal.x * offset,
    y: segment.start.y + (segment.end.y - segment.start.y) * t + inwardNormal.y * offset,
  };

  return [sampleGapPx, sampleGapPx + 2, sampleGapPx + 4]
    .map(gap => colorContrast(imageData, point, inwardNormal, gap))
    .reduce((sum, score) => sum + score, 0);
}

function fitLocalOffset(
  imageData: ImageData,
  segment: SvgLineSegment,
  inwardNormal: SvgPoint,
  t: number,
  inwardSearchPx: number,
  outwardSearchPx: number,
  sampleGapPx: number
): LocalFit {
  const baseScore = scoreOffset(imageData, segment, inwardNormal, t, 0, sampleGapPx);
  let bestOffset = 0;
  let bestScore = baseScore;

  for (let offset = -outwardSearchPx; offset <= inwardSearchPx; offset += 1) {
    const score = scoreOffset(imageData, segment, inwardNormal, t, offset, sampleGapPx);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return { baseScore, bestOffset, bestScore };
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load satellite image for edge fitting'));
    image.src = imageUrl;
  });
}

async function createImageData(
  imageUrl: string,
  imagePlacement: ImagePlacement,
  canvasWidth: number,
  canvasHeight: number
) {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) return null;

  ctx.drawImage(image, imagePlacement.left, imagePlacement.top, imagePlacement.width, imagePlacement.height);
  return ctx.getImageData(0, 0, canvasWidth, canvasHeight);
}

export async function autoFitEasternEave({
  canvasWidth,
  canvasHeight,
  eaveSegments,
  imagePlacement,
  imageUrl,
  inwardSearchPx = 18,
  outwardSearchPx = 6,
  sampleGapPx = 2.5,
}: AutoFitEasternEaveOptions): Promise<SvgLineSegment[] | null> {
  if (typeof window === 'undefined' || eaveSegments.length === 0) return null;

  const eastIndex = eaveSegments.reduce((bestIndex, segment, index, segments) => {
    const bestMidX = (segments[bestIndex].start.x + segments[bestIndex].end.x) / 2;
    const currentMidX = (segment.start.x + segment.end.x) / 2;
    return currentMidX > bestMidX ? index : bestIndex;
  }, 0);

  const eastSegment = eaveSegments[eastIndex];
  const dx = eastSegment.end.x - eastSegment.start.x;
  const dy = eastSegment.end.y - eastSegment.start.y;
  const segmentLengthPx = Math.hypot(dx, dy);
  if (segmentLengthPx < 24) return null;

  const roofCenter = eaveSegments.reduce(
    (acc, segment) => ({
      x: acc.x + (segment.start.x + segment.end.x) / 2,
      y: acc.y + (segment.start.y + segment.end.y) / 2,
    }),
    { x: 0, y: 0 }
  );
  roofCenter.x /= eaveSegments.length;
  roofCenter.y /= eaveSegments.length;

  const baseNormal = { x: -dy / segmentLengthPx, y: dx / segmentLengthPx };
  const segmentMidpoint = {
    x: (eastSegment.start.x + eastSegment.end.x) / 2,
    y: (eastSegment.start.y + eastSegment.end.y) / 2,
  };
  const toCenter = { x: roofCenter.x - segmentMidpoint.x, y: roofCenter.y - segmentMidpoint.y };
  const inwardNormal =
    baseNormal.x * toCenter.x + baseNormal.y * toCenter.y >= 0
      ? baseNormal
      : { x: -baseNormal.x, y: -baseNormal.y };

  const imageData = await createImageData(imageUrl, imagePlacement, canvasWidth, canvasHeight);
  if (!imageData) return null;

  const sampleTs = [0.12, 0.22, 0.32, 0.42, 0.58, 0.68, 0.78, 0.88];
  const fits = sampleTs.map(t =>
    fitLocalOffset(imageData, eastSegment, inwardNormal, t, inwardSearchPx, outwardSearchPx, sampleGapPx)
  );

  const baseScore = average(fits.map(fit => fit.baseScore));
  const fittedScore = average(fits.map(fit => fit.bestScore));
  const startOffset = average(fits.slice(0, 4).map(fit => fit.bestOffset));
  const endOffset = average(fits.slice(-4).map(fit => fit.bestOffset));

  if (fittedScore < baseScore * 1.04 && fittedScore - baseScore < 12) {
    return null;
  }

  const limitedStartOffset = clamp(startOffset, -outwardSearchPx, inwardSearchPx);
  const limitedEndOffset = clamp(endOffset, limitedStartOffset - 8, limitedStartOffset + 8);

  if (Math.abs(limitedStartOffset) < 0.75 && Math.abs(limitedEndOffset) < 0.75) {
    return null;
  }

  const adjustedSegment: SvgLineSegment = {
    ...eastSegment,
    start: {
      x: eastSegment.start.x + inwardNormal.x * limitedStartOffset,
      y: eastSegment.start.y + inwardNormal.y * limitedStartOffset,
    },
    end: {
      x: eastSegment.end.x + inwardNormal.x * limitedEndOffset,
      y: eastSegment.end.y + inwardNormal.y * limitedEndOffset,
    },
  };

  return eaveSegments.map((segment, index) => (index === eastIndex ? adjustedSegment : segment));
}