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
  if (backbone) return backboneOnlyModel(backbone);
  return null;
}
