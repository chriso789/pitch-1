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

/** Self-hosted weight URLs (large files live in the asset store, pointer JSON in the repo). */
export const MODEL_URLS = {
  componentSegmenter: '/models/photo-intelligence/component-segmenter.onnx',
  dinov2Small: dinov2SmallAsset.url,
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
  const seg = await tryLoadSession(MODEL_URLS.componentSegmenter);
  if (seg) return backboneOnlyModel(seg); // replace with a real head once verified
  const backbone = await tryLoadSession(MODEL_URLS.dinov2Small);
  if (backbone) return dinov2SimilarityModel(backbone);
  return null;
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
