/**
 * Region embeddings from a SINGLE DINOv2 pass (Phase 3 performance rule:
 * run the backbone once per source image and reuse its embeddings).
 *
 * DINOv2-Small yields a 16×16 grid of patch embeddings per image. A
 * region's embedding is the mean of the patch embeddings whose centres
 * fall inside the region polygon — no second inference call, no cropping
 * round-trip. Mean-pooled patch embeddings are similarity features only:
 * they feed the reference classifier, never a damage verdict.
 *
 * Embeddings are cached by content hash + model version so unchanged
 * photographs are never re-processed (cache is in-memory per session).
 */

import type { GrayImage } from '../patternAnalysis';
import { loadOrt, preprocessForDino, patchEmbeddingsFromOutput, type LoadedOnnxModel } from './onnxModel';

export interface DinoImageFeatures {
  /** 16×16 patch embeddings, row-major. */
  patches: Float32Array[];
  cols: number;
  rows: number;
  /** Content hash key used for caching. */
  contentHash: string;
  modelId: string;
}

/** djb2 over a sampled subset of pixels — cheap content identity, not cryptographic. */
export function contentHashOf(img: GrayImage): string {
  const { data, width, height } = img;
  let h1 = 5381, h2 = 52711;
  const step = Math.max(4, Math.floor(data.length / 4096) * 4);
  for (let i = 0; i < data.length; i += step) {
    h1 = ((h1 << 5) + h1 + data[i]) >>> 0;
    h2 = ((h2 << 5) + h2 + data[i + 1]) >>> 0;
  }
  return `${width}x${height}-${h1.toString(36)}-${h2.toString(36)}`;
}

const cache = new Map<string, DinoImageFeatures>();
const CACHE_LIMIT = 32;

function cacheKey(modelId: string, hash: string) {
  return `${modelId}:${hash}`;
}

/** Compute (or fetch cached) DINOv2 patch features for an image — one inference per unique image. */
export async function dinoFeaturesForImage(
  img: GrayImage,
  loaded: LoadedOnnxModel,
): Promise<DinoImageFeatures | null> {
  const hash = contentHashOf(img);
  const key = cacheKey(loaded.modelId, hash);
  const hit = cache.get(key);
  if (hit) return hit;
  const session = loaded.session as {
    inputNames: string[];
    run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
  };
  const ort = await loadOrt();
  const { data, dims } = preprocessForDino(img);
  const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, dims) });
  const first = outputs[Object.keys(outputs)[0]];
  if (!first || first.dims.length !== 3) return null;
  const grid = patchEmbeddingsFromOutput(first);
  const features: DinoImageFeatures = { patches: grid.embeddings, cols: grid.cols, rows: grid.rows, contentHash: hash, modelId: loaded.modelId };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, features);
  return features;
}

/** Point-in-polygon (normalized coordinates). */
function insidePolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Mean-pool the patch embeddings whose centres fall inside a normalized
 * region polygon. Returns null when the polygon covers no patch centres
 * (too small to embed honestly — caller must treat as unknown, never
 * stretch the region to force a match).
 */
export function poolRegionEmbedding(
  features: DinoImageFeatures,
  polygonNorm: { x: number; y: number }[],
): Float32Array | null {
  if (!polygonNorm.length) return null;
  const dim = features.patches[0]?.length ?? 0;
  if (!dim) return null;
  const acc = new Float32Array(dim);
  let count = 0;
  for (let r = 0; r < features.rows; r++) for (let c = 0; c < features.cols; c++) {
    const px = (c + 0.5) / features.cols;
    const py = (r + 0.5) / features.rows;
    if (!insidePolygon(px, py, polygonNorm)) continue;
    const emb = features.patches[r * features.cols + c];
    for (let i = 0; i < dim; i++) acc[i] += emb[i];
    count++;
  }
  if (count === 0) return null;
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = acc[i] / count;
  return out;
}
