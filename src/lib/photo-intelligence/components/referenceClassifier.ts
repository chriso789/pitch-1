/**
 * Phase 1 — reference-based component recognition.
 *
 * A nearest-prototype classifier over DINOv2 embeddings. It compares an
 * image region's embedding against a curated, versioned library of
 * INDEPENDENTLY APPROVED reference examples (inspector-corrected crops,
 * never unverified model predictions) and returns a component label ONLY
 * when all of the following hold:
 *
 *   1. best cosine similarity >= minSimilarity (absolute evidence floor)
 *   2. margin over the best competing class >= minMargin (separation)
 *   3. the region passed image-quality gating upstream (caller enforces)
 *
 * Otherwise it returns `unknown`. Similarity alone never proves component
 * identity, and a component label never proves damage — condition analysis
 * is a separate evaluation (component recognition vs damage recognition
 * must be benchmarked independently).
 *
 * Hard negatives (shadows, debris, repairs, colour variation) are
 * first-class reference classes: a region closer to a hard-negative
 * prototype than to any component prototype is reported as that negative
 * class, NOT as a component — reducing false damage alerts.
 */

import { UNKNOWN_COMPONENT, type RoofComponentClass } from './componentRecognition';

/** Hard-negative reference classes: harmless looks that must not become components or damage. */
export const HARD_NEGATIVE_CLASSES = ['shadow', 'debris', 'repair', 'color_variation'] as const;
export type HardNegativeClass = (typeof HARD_NEGATIVE_CLASSES)[number];
export type ReferenceClass = RoofComponentClass | HardNegativeClass;

/** One approved reference example: an embedding plus its verified label. */
export interface ReferenceExample {
  id: string;
  cls: ReferenceClass;
  /** DINOv2 embedding (L2-normalized on insert). */
  embedding: Float32Array;
  /** Library version this example entered at — provenance is mandatory. */
  libraryVersion: number;
  /** Photo + region this crop came from (traceability; originals immutable). */
  sourcePhotoId: string;
  sourceRegionId: string;
  /** Independent approver — must differ from the labeler (enforced upstream). */
  approvedBy: string;
}

export interface VersionedReferenceLibrary {
  version: number;
  /** DINOv2 model id these embeddings were computed with — never mix models. */
  embeddingModelId: string;
  examples: ReferenceExample[];
}

export interface ClassificationThresholds {
  /** Absolute cosine floor for the best class. */
  minSimilarity: number;
  /** Required gap between best component class and best competing class. */
  minMargin: number;
}

/** Conservative starting thresholds — must be re-validated on real photos. */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  minSimilarity: 0.62,
  minMargin: 0.05,
};

export type ClassificationResult =
  | {
      kind: 'component';
      cls: RoofComponentClass;
      /** Cosine similarity of the winning prototype, 0..1. Never amplified. */
      similarity: number;
      margin: number;
      nearestExampleId: string;
    }
  | { kind: 'hard_negative'; cls: HardNegativeClass; similarity: number; margin: number; nearestExampleId: string }
  | { kind: 'unknown'; reason: 'empty_library' | 'below_similarity' | 'insufficient_margin'; bestSimilarity: number | null };

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** L2-normalize a copy of an embedding (library entries are stored normalized). */
export function normalizeEmbedding(e: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < e.length; i++) n += e[i] * e[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(e.length);
  for (let i = 0; i < e.length; i++) out[i] = e[i] / n;
  return out;
}

/**
 * Classify a region embedding against the reference library.
 * Nearest-prototype: each example votes with its cosine similarity; a class
 * score is its best example's similarity. Returns `unknown` whenever the
 * evidence does not clear BOTH thresholds.
 */
export function classifyRegion(
  embedding: Float32Array,
  library: VersionedReferenceLibrary,
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
): ClassificationResult {
  if (!library.examples.length) return { kind: 'unknown', reason: 'empty_library', bestSimilarity: null };
  const query = normalizeEmbedding(embedding);
  const hardNegatives = new Set<string>(HARD_NEGATIVE_CLASSES);
  let best: { cls: ReferenceClass; sim: number; id: string } | null = null;
  let bestOther = -1;
  for (const ex of library.examples) {
    const sim = cosineSimilarity(query, ex.embedding);
    if (!best || sim > best.sim) {
      if (best && best.cls !== ex.cls) bestOther = Math.max(bestOther, best.sim);
      best = { cls: ex.cls, sim, id: ex.id };
    } else if (ex.cls !== best.cls) {
      bestOther = Math.max(bestOther, sim);
    }
  }
  if (!best || best.sim < thresholds.minSimilarity) {
    return { kind: 'unknown', reason: 'below_similarity', bestSimilarity: best?.sim ?? null };
  }
  const margin = bestOther < 0 ? best.sim : best.sim - bestOther;
  if (margin < thresholds.minMargin) {
    return { kind: 'unknown', reason: 'insufficient_margin', bestSimilarity: best.sim };
  }
  if (hardNegatives.has(best.cls)) {
    return { kind: 'hard_negative', cls: best.cls as HardNegativeClass, similarity: best.sim, margin, nearestExampleId: best.id };
  }
  return { kind: 'component', cls: best.cls as RoofComponentClass, similarity: best.sim, margin, nearestExampleId: best.id };
}

/**
 * Add an independently approved example to the library. Pure function —
 * persistence lives with the caller. Enforces provenance fields so a
 * reference can never enter the library untraceably.
 */
export function addApprovedExample(
  library: VersionedReferenceLibrary,
  example: ReferenceExample,
): VersionedReferenceLibrary {
  if (!example.id || !example.sourcePhotoId || !example.sourceRegionId || !example.approvedBy) {
    throw new Error('Reference examples require id, source photo, source region and independent approver.');
  }
  if (!example.embedding.length) throw new Error('Reference example has an empty embedding.');
  if (library.examples.some((e) => e.id === example.id)) {
    throw new Error('Duplicate reference example id.');
  }
  return {
    ...library,
    examples: [...library.examples, { ...example, embedding: normalizeEmbedding(example.embedding) }],
  };
}

/** Empty library at a given version for a given embedding model. */
export function emptyLibrary(embeddingModelId: string, version = 1): VersionedReferenceLibrary {
  return { version, embeddingModelId, examples: [] };
}

/** Component recognition is not damage recognition — this type keeps them separate in results. */
export interface ComponentClassScore {
  cls: ReferenceClass | typeof UNKNOWN_COMPONENT;
  similarity: number | null;
}
