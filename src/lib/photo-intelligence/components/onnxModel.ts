/**
 * Local ONNX model loader for the component-recognition layer.
 *
 * Loads self-hosted .onnx weights with onnxruntime-web (MIT). No external
 * inference service is ever contacted. If the weight file is absent the
 * loader resolves to null — callers must treat that as "model not
 * available", never as a reason to invent components.
 *
 * Weights are NOT committed to the repo: each model must pass the Phase-1
 * license audit (docs/PHOTO_COMPONENT_MODEL_AUDIT.md), be downloaded from
 * its official source, and be hash-verified before being placed under
 * public/models/photo-intelligence/.
 */

import type { ComponentModel, ComponentRegion } from './componentRecognition';
import type { GrayImage } from '../patternAnalysis';
import dinov2SmallAsset from '@/assets/dinov2-small.onnx.asset.json';
import sam2EncoderAsset from '@/assets/sam2.1-tiny-vision-encoder.onnx.asset.json';
import sam2DecoderAsset from '@/assets/sam2.1-tiny-mask-decoder.onnx.asset.json';

/** Self-hosted weight URLs (large files live in the asset store, pointer JSON in the repo). */
export const MODEL_URLS = {
  componentSegmenter: '/models/photo-intelligence/component-segmenter.onnx',
  dinov2Small: dinov2SmallAsset.url,
  sam2Encoder: sam2EncoderAsset.url,
  sam2Decoder: sam2DecoderAsset.url,
} as const;

export interface LoadedOnnxModel {
  modelId: string;
  verifiedClasses: readonly string[];
  /** Raw ONNX session (typed loosely to keep the import lazy). */
  session: unknown;
  inputName: string;
}

type OrtModule = typeof import('onnxruntime-web');

let ortPromise: Promise<OrtModule> | null = null;
/** Lazy-load the runtime so the WASM assets never enter the main bundle path. */
export function loadOrt(): Promise<OrtModule> {
  ortPromise ??= import('onnxruntime-web');
  return ortPromise;
}

/**
 * Try to load an ONNX session from a self-hosted URL. Returns null when the
 * file is missing or unloadable — this is a normal "not installed" state.
 */
export async function tryLoadSession(url: string): Promise<LoadedOnnxModel | null> {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return null;
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
    return { modelId: url, verifiedClasses: [], session, inputName: session.inputNames[0] };
  } catch {
    return null;
  }
}

/**
 * A DINOv2-style feature extractor is NOT a component segmenter: it produces
 * patch embeddings, not labelled regions. Until a verified segmentation head
 * exists, a feature backbone alone yields zero regions — every component
 * stays `unknown` upstream. This guard exists so a half-integrated backbone
 * can never be mistaken for component recognition.
 */
export function backboneOnlyModel(loaded: LoadedOnnxModel): ComponentModel {
  return {
    modelId: loaded.modelId,
    verifiedClasses: [],
    async segment(_img: GrayImage): Promise<ComponentRegion[]> {
      return [];
    },
  };
}

/**
 * Load the best available component model, or null when none is installed.
 * Order mirrors the audit decision: a verified segmentation model first.
 */
export async function loadComponentModel(): Promise<ComponentModel | null> {
  const [encoder, decoder] = await Promise.all([
    tryLoadSession(MODEL_URLS.sam2Encoder),
    tryLoadSession(MODEL_URLS.sam2Decoder),
  ]);
  if (encoder && decoder) return sam2SegmentationModel(encoder, decoder);
  const seg = await tryLoadSession(MODEL_URLS.componentSegmenter);
  if (seg) return backboneOnlyModel(seg); // replace with a real head once verified
  const backbone = await tryLoadSession(MODEL_URLS.dinov2Small);
  if (backbone) return dinov2SimilarityModel(backbone);
  return null;
}

// ---------------------------------------------------------------------------
// SAM 2.1 Tiny promptable segmentation (Apache-2.0, validated end-to-end
// 2026-10-19: encoder [1,3,1024,1024] → 3 embedding tensors; decoder
// box-prompted → iou_scores + pred_masks at 256×256).
//
// SAM produces masks WITHOUT semantic labels. Regions are therefore returned
// with component `unknown` — the masks refine anomaly geometry for inspector
// review, they do not identify roofing components. A region is never
// upgraded to a named component or to damage.
// ---------------------------------------------------------------------------

const SAM_INPUT = 1024;
const SAM_MASK = 256;

/** Preprocess for the SAM 2.1 vision encoder (per onnx-community preprocessor_config). */
export function preprocessForSam(img: GrayImage): { data: Float32Array; dims: number[] } {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(3 * SAM_INPUT * SAM_INPUT);
  for (let y = 0; y < SAM_INPUT; y++) for (let x = 0; x < SAM_INPUT; x++) {
    const sx = Math.min(w - 1, Math.floor((x * w) / SAM_INPUT));
    const sy = Math.min(h - 1, Math.floor((y * h) / SAM_INPUT));
    const i = (sy * w + sx) * 4;
    for (let c = 0; c < 3; c++) {
      out[c * SAM_INPUT * SAM_INPUT + y * SAM_INPUT + x] =
        (data[i + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return { data: out, dims: [1, 3, SAM_INPUT, SAM_INPUT] };
}

/** Largest contour of a binary mask as a normalized polygon (marching-squares-free: boundary cells' convex hull). */
export function maskToPolygonNorm(mask: Float32Array, side: number, threshold = 0): { x: number; y: number }[] | null {
  const pts: { x: number; y: number }[] = [];
  let count = 0;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < side && y < side && mask[y * side + x] > threshold;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    if (!on(x, y)) continue;
    count++;
    if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) {
      pts.push({ x: x / side, y: y / side }, { x: (x + 1) / side, y: (y + 1) / side });
    }
  }
  if (count < 16 || pts.length < 3) return null;
  // Convex hull (Andrew monotone chain).
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof pts = [], upper: typeof pts = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface OrtSession {
  inputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
}

/**
 * SAM 2.1 segmentation model. Segment-by-box-prompt over a coarse grid;
 * each mask is an unlabeled region. `verifiedClasses` stays empty, so the
 * recognition layer keeps every region `unknown`.
 */
export function sam2SegmentationModel(encoder: LoadedOnnxModel, decoder: LoadedOnnxModel): ComponentModel {
  const enc = encoder.session as OrtSession;
  const dec = decoder.session as OrtSession;
  return {
    modelId: 'sam2.1-hiera-tiny',
    verifiedClasses: [],
    async segment(img: GrayImage): Promise<ComponentRegion[]> {
      const ort = await loadOrt();
      const { data, dims } = preprocessForSam(img);
      const encOut = await enc.run({ pixel_values: new ort.Tensor('float32', data, dims) });
      // Prompt with a grid of boxes so surface-scale regions are proposed.
      const boxes: number[][][] = [];
      const GRID_BOXES = 4;
      for (let gy = 0; gy < GRID_BOXES; gy++) for (let gx = 0; gx < GRID_BOXES; gx++) {
        boxes.push([[
          (gx * SAM_INPUT) / GRID_BOXES, (gy * SAM_INPUT) / GRID_BOXES,
          ((gx + 1) * SAM_INPUT) / GRID_BOXES, ((gy + 1) * SAM_INPUT) / GRID_BOXES,
        ]]);
      }
      const feeds: Record<string, unknown> = {
        input_points: new ort.Tensor('float32', new Float32Array(boxes.length * 2), [boxes.length, 1, 1, 2]),
        input_labels: new ort.Tensor('int64', new BigInt64Array(boxes.length), [boxes.length, 1, 1]),
        input_boxes: new ort.Tensor('float32', new Float32Array(boxes.flat(2)), [boxes.length, boxes[0].length, 4]),
        'image_embeddings.0': encOut['image_embeddings.0'],
        'image_embeddings.1': encOut['image_embeddings.1'],
        'image_embeddings.2': encOut['image_embeddings.2'],
      };
      const out = await dec.run(feeds);
      const masks = out['pred_masks']; // [boxes, 1, 3, 256, 256]
      const ious = out['iou_scores'];   // [boxes, 1, 3]
      if (!masks || !ious) return [];
      const regions: ComponentRegion[] = [];
      const seen: { x: number; y: number }[][] = [];
      for (let b = 0; b < boxes.length; b++) {
        // Pick the best-IoU of the 3 candidate masks for this prompt.
        let best = 0;
        for (let m = 1; m < 3; m++) if (ious.data[b * 3 + m] > ious.data[b * 3 + best]) best = m;
        if (ious.data[b * 3 + best] < 0.7) continue; // low self-agreement: not a stable region
        const offset = (b * 3 + best) * SAM_MASK * SAM_MASK;
        const polygon = maskToPolygonNorm(masks.data.slice(offset, offset + SAM_MASK * SAM_MASK), SAM_MASK);
        if (!polygon) continue;
        // Drop near-duplicates of an already-returned region.
        const dup = seen.some((s) => {
          const xs = s.map((p) => p.x), ys = s.map((p) => p.y);
          const nxs = polygon.map((p) => p.x), nys = polygon.map((p) => p.y);
          return Math.max(Math.min(...xs), Math.min(...nxs)) < Math.min(Math.max(...xs), Math.max(...nxs)) &&
                 Math.max(Math.min(...ys), Math.min(...nys)) < Math.min(Math.max(...ys), Math.max(...nys)) &&
                 Math.abs(Math.max(...xs) - Math.min(...xs) - (Math.max(...nxs) - Math.min(...nxs))) < 0.05;
        });
        if (dup) continue;
        seen.push(polygon);
        regions.push({ polygonNorm: polygon, component: 'unknown', confidence: null });
      }
      return regions;
    },
  };
}

// ---------------------------------------------------------------------------
// DINOv2 patch-embedding similarity (Phase 2 partial: feature extraction +
// similarity comparison; NOT component recognition — no segmentation head
// exists yet, so the model contributes zero labelled component regions).
// ---------------------------------------------------------------------------

const DINO_INPUT = 224;
const DINO_PATCH = 14;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

/** Preprocess an RGBA image to a normalized CHW float tensor for DINOv2. */
export function preprocessForDino(img: GrayImage): { data: Float32Array; dims: number[] } {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(3 * DINO_INPUT * DINO_INPUT);
  for (let y = 0; y < DINO_INPUT; y++) for (let x = 0; x < DINO_INPUT; x++) {
    const sx = Math.min(w - 1, Math.floor((x * w) / DINO_INPUT));
    const sy = Math.min(h - 1, Math.floor((y * h) / DINO_INPUT));
    const i = (sy * w + sx) * 4;
    for (let c = 0; c < 3; c++) {
      out[c * DINO_INPUT * DINO_INPUT + y * DINO_INPUT + x] =
        (data[i + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return { data: out, dims: [1, 3, DINO_INPUT, DINO_INPUT] };
}

interface PatchGrid { embeddings: Float32Array[]; cols: number; rows: number }

/** Extract per-patch embeddings from a DINOv2 session output. */
export function patchEmbeddingsFromOutput(output: { data: Float32Array; dims: readonly number[] }): PatchGrid {
  // Expected: [1, tokens, dim]; token 0 is CLS, remaining are patch tokens.
  const tokens = output.dims[1];
  const dim = output.dims[2];
  const patches = tokens - 1;
  const side = Math.sqrt(patches);
  const cols = Math.round(side), rows = Math.round(patches / cols);
  const embeddings: Float32Array[] = [];
  for (let t = 1; t < tokens; t++) embeddings.push(output.data.slice(t * dim, (t + 1) * dim));
  return { embeddings, cols, rows };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Median cosine similarity of each patch to its 4-neighbours (1 = identical look). */
export function neighbourSimilarity(grid: PatchGrid): Float32Array {
  const { embeddings, cols, rows } = grid;
  const out = new Float32Array(embeddings.length).fill(1);
  for (let i = 0; i < embeddings.length; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    const sims: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) sims.push(cosine(embeddings[i], embeddings[ny * cols + nx]));
    }
    sims.sort((a, b) => a - b);
    if (sims.length) out[i] = sims[Math.floor(sims.length / 2)];
  }
  return out;
}

/**
 * A DINOv2 backbone used for what it is licensed and able to do: feature
 * extraction and similarity. It still reports NO component regions — that
 * requires a verified segmentation head. The similarity scores are exposed
 * for the pattern layer to consume as evidence, never as damage labels.
 */
export function dinov2SimilarityModel(loaded: LoadedOnnxModel): ComponentModel & {
  patchSimilarity(img: GrayImage): Promise<Float32Array | null>;
} {
  return {
    modelId: 'dinov2-small',
    verifiedClasses: [],
    async segment(): Promise<ComponentRegion[]> { return []; },
    async patchSimilarity(img: GrayImage): Promise<Float32Array | null> {
      const session = loaded.session as {
        inputNames: string[];
        run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
      };
      const ort = await loadOrt();
      const { data, dims } = preprocessForDino(img);
      const tensor = new ort.Tensor('float32', data, dims);
      const outputs = await session.run({ [session.inputNames[0]]: tensor });
      const first = outputs[Object.keys(outputs)[0]];
      if (!first || first.dims.length !== 3) return null;
      return neighbourSimilarity(patchEmbeddingsFromOutput(first));
    },
  };
}
