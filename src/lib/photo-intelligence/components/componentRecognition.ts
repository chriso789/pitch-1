/**
 * Phase 2/3 — component-aware recognition layer (foundation).
 *
 * This module defines how a locally run, pretrained vision model plugs into
 * Photo Intelligence. It deliberately ships with NO model: without validated
 * PITCH-controlled weights, `recognizeComponents` returns every region as
 * `unknown` and never guesses a roofing component. This mirrors the
 * constraint that untrained pattern analysis yields possible anomalies only.
 *
 * Hard rules:
 *  - Component labels come only from a verified local model (ONNX Runtime on
 *    PITCH-controlled infrastructure or supported client hardware). No
 *    OpenAI, Lovable AI, or other external paid inference APIs.
 *  - A model class is reported only after it appears in the model's verified
 *    class list; everything else is `unknown`.
 *  - Component recognition never converts a pattern-analysis anomaly into
 *    confirmed damage; it only refines which regions are compared and what
 *    they are labelled for inspector review.
 */

import type { GrayImage, PatternOutcome } from '../patternAnalysis';
import type { RawDetection } from '../recognition';

/** Roofing components PITCH aims to recognize (spec Phase 2). */
export const ROOF_COMPONENT_CLASSES = [
  'clay_tile', 'concrete_tile', 'asphalt_shingle', 'metal_panel',
  'ridge_cap', 'roof_vent', 'flashing', 'penetration',
  'gutter', 'valley', 'siding', 'exposed_underlayment',
] as const;
export type RoofComponentClass = (typeof ROOF_COMPONENT_CLASSES)[number];
export const UNKNOWN_COMPONENT = 'unknown' as const;

export interface ComponentRegion {
  /** Normalized 0..1 polygon the model attributed to one component. */
  polygonNorm: { x: number; y: number }[];
  /** Verified class, or `unknown` when the model cannot identify it. */
  component: RoofComponentClass | typeof UNKNOWN_COMPONENT;
  /** Model confidence 0..1, or null when not meaningful. Never amplified. */
  confidence: number | null;
}

export interface ComponentRecognitionOutcome {
  status: 'components_found' | 'model_not_available';
  regions: ComponentRegion[];
  warnings: string[];
}

/** Contract a locally run pretrained model must satisfy to be plugged in. */
export interface ComponentModel {
  readonly modelId: string;
  /** Classes verified for this build — only these may be reported. */
  readonly verifiedClasses: readonly string[];
  segment(img: GrayImage): Promise<ComponentRegion[]>;
}

/**
 * Run component recognition. With no model installed (today), returns
 * `model_not_available` with zero regions — never an invented component.
 */
export async function recognizeComponents(
  img: GrayImage,
  model?: ComponentModel,
): Promise<ComponentRecognitionOutcome> {
  if (!model) {
    return {
      status: 'model_not_available',
      regions: [],
      warnings: ['No verified PITCH component model is installed; components are reported as unknown and the pattern-analysis layer is used alone.'],
    };
  }
  const regions = await model.segment(img);
  const verified = new Set(model.verifiedClasses);
  return {
    status: 'components_found',
    regions: regions.map((r) =>
      r.component !== UNKNOWN_COMPONENT && !verified.has(r.component)
        ? { ...r, component: UNKNOWN_COMPONENT, confidence: null }
        : r,
    ),
    warnings: [],
  };
}

/**
 * Phase 3 — combine component boundaries with the pattern-analysis outcome.
 * Until a component model exists this is an honest pass-through: anomaly
 * wording states that regions could not be matched to a recognized
 * component, so they remain unclassified possible anomalies.
 */
export function refineWithComponents(
  pattern: PatternOutcome,
  components: ComponentRecognitionOutcome,
): PatternOutcome {
  if (components.status !== 'components_found' || !pattern.result.detections.length) {
    const note = 'No recognized roof component could be matched to this region; it stays an unclassified possible anomaly.';
    return {
      ...pattern,
      result: {
        ...pattern.result,
        detections: pattern.result.detections.map((d: RawDetection) => ({
          ...d,
          condition: d.condition?.includes(note) ? d.condition : `${d.condition ?? ''} ${note}`.trim(),
        })),
        warnings: [...(pattern.result.warnings ?? []), ...components.warnings],
      },
    };
  }
  // Component-aware comparison requires a verified model; not yet active.
  return pattern;
}

/** Normalized bbox of a polygon. */
function bboxOf(poly: { x: number; y: number }[]) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Intersection-over-union of two normalized polygons' bounding boxes. */
export function polygonIoU(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  const A = bboxOf(a), B = bboxOf(b);
  const ix = Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0));
  const iy = Math.max(0, Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0));
  const inter = ix * iy;
  const area = (p: typeof A) => Math.max(0, p.x1 - p.x0) * Math.max(0, p.y1 - p.y0);
  const union = area(A) + area(B) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Phase 3 partial — match pattern-analysis anomalies against segmented
 * regions. A mask from SAM has no label, so this only refines evidence
 * wording: an anomaly inside a segmented region says which visual feature
 * stood out AND that a distinct surface region underlies it. The anomaly
 * stays `possible_anomaly` with component `Unclassified surface`; it is
 * never upgraded to a named component or to damage.
 */
export function matchAnomaliesToRegions(
  pattern: PatternOutcome,
  components: ComponentRecognitionOutcome,
): PatternOutcome {
  if (components.status !== 'components_found' || !components.regions.length) return pattern;
  const detections = pattern.result.detections.map((d: RawDetection) => {
    if (!d.polygonNorm) return d;
    const hit = components.regions.find((r) => polygonIoU(d.polygonNorm!, r.polygonNorm) > 0.15);
    if (!hit) return d;
    const note = 'This area falls inside a distinct surface region outlined by the segmentation model (region type not identified).';
    return { ...d, condition: d.condition?.includes(note) ? d.condition : `${d.condition ?? ''} ${note}`.trim() };
  });
  return { ...pattern, result: { ...pattern.result, detections } };
}
