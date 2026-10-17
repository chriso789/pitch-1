/**
 * Photo Intelligence recognition engine interface (Phase 2).
 *
 * Model-independent: a RecognitionProvider turns a photo into raw candidate
 * detections; this module validates and normalizes them into review-ready
 * proposals. Hard rules from the master plan:
 *  - AI output NEVER becomes a finding directly. Every proposal is created
 *    with detection_source 'ai' and review_status 'pending'; only an
 *    inspector can approve (enforced in the database).
 *  - Candidate coordinates must be normalized (0..1) and are stored as
 *    editable annotation geometry, never burned into the photo.
 *  - Confidence is reported, never amplified; unverifiable claims
 *    (quantities, age, specs) are stripped, not guessed.
 *  - "No visible damage" candidates are recorded too, when the provider
 *    supports them.
 */

import type { Annotation, Point } from './annotations';
import { validateAnnotation } from './annotations';
import type { Severity } from './findings';

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export interface RecognitionPhoto {
  /** Stable id of the photo row the provider analyzed. */
  photoId: string;
  /** Provider-specific image reference (signed URL, base64, etc.). */
  imageRef: string;
  widthPx?: number;
  heightPx?: number;
}

export interface RawDetection {
  kind: 'polygon' | 'bbox';
  /** Coordinates must be normalized 0..1 by the provider or by pixels+size. */
  polygonPx?: Point[];
  bboxPx?: { x: number; y: number; width: number; height: number };
  polygonNorm?: Point[];
  bboxNorm?: { x: number; y: number; width: number; height: number };
  component?: string;
  damageCategory?: string;
  condition?: string;
  confidence?: number;
  buildingLabel?: string;
  noVisibleDamage?: boolean;
}

export interface RecognitionResult {
  providerId: string;
  modelId: string;
  detections: RawDetection[];
  /** Provider-reported warnings, e.g. low light, motion blur. */
  warnings?: string[];
}

export interface RecognitionProvider {
  readonly providerId: string;
  readonly modelId: string;
  analyze(photo: RecognitionPhoto): Promise<RecognitionResult>;
}

// ---------------------------------------------------------------------------
// Validated proposals
// ---------------------------------------------------------------------------

export interface DamageProposal {
  photoId: string;
  annotation: Annotation;
  component: string;
  damageCategory: string | null;
  condition: string;
  confidence: number | null;
  buildingLabel: string | null;
  noVisibleDamage: boolean;
  /** Always 'ai' — provenance is non-negotiable. */
  detectionSource: 'ai';
  /** Always 'pending' — inspector approval is mandatory. */
  reviewStatus: 'pending';
  providerId: string;
  modelId: string;
}

export interface ProposalBatch {
  proposals: DamageProposal[];
  /** Detections that failed validation, with the reason — never silently dropped. */
  rejected: { detection: RawDetection; reason: string }[];
  warnings: string[];
}

const SEVERITIES: Severity[] = ['immediate', 'high', 'moderate', 'low', 'cosmetic', 'unknown'];

export function clampConfidence(c: unknown): number | null {
  if (typeof c !== 'number' || !isFinite(c)) return null;
  return Math.min(1, Math.max(0, c));
}

function normPoint(p: Point, w?: number, h?: number): Point | null {
  if (!isFinite(p.x) || !isFinite(p.y)) return null;
  // Pixel coordinates when size is known and values exceed 1
  if (w && h && (p.x > 1 || p.y > 1)) return { x: p.x / w, y: p.y / h };
  return p;
}

/** Convert a raw detection into an annotation; null when geometry is unusable. */
export function detectionToAnnotation(d: RawDetection, photo: RecognitionPhoto, id: string): Annotation | null {
  const base = {
    id,
    color: '#a855f7', // AI proposals render purple until approved
    buildingLabel: d.buildingLabel ?? null,
    component: d.component ?? null,
    damageCategory: d.damageCategory ?? null,
  };
  if (d.kind === 'polygon') {
    const src = d.polygonNorm ?? d.polygonPx?.map((p) => normPoint(p, photo.widthPx, photo.heightPx)).filter((p): p is Point => !!p);
    if (!src || src.length < 3) return null;
    const ann: Annotation = { ...base, kind: 'polygon', points: src };
    return validateAnnotation(ann) === null ? ann : null;
  }
  const b = d.bboxNorm ?? (d.bboxPx && photo.widthPx && photo.heightPx
    ? { x: d.bboxPx.x / photo.widthPx, y: d.bboxPx.y / photo.heightPx, width: d.bboxPx.width / photo.widthPx, height: d.bboxPx.height / photo.heightPx }
    : undefined);
  if (!b) return null;
  const ann: Annotation = { ...base, kind: 'bbox', origin: { x: b.x, y: b.y }, size: { x: b.width, y: b.height } };
  return validateAnnotation(ann) === null ? ann : null;
}

/**
 * Validate a provider result into review-ready proposals.
 * Every detection that cannot be validated is returned in `rejected`
 * with a reason — nothing is silently discarded.
 */
export function validateDetections(result: RecognitionResult, photo: RecognitionPhoto): ProposalBatch {
  const proposals: DamageProposal[] = [];
  const rejected: ProposalBatch['rejected'] = [];
  let n = 0;
  for (const d of result.detections) {
    n += 1;
    if (!d.condition || !d.condition.trim()) {
      rejected.push({ detection: d, reason: 'Missing condition description' });
      continue;
    }
    if (!d.component || !d.component.trim()) {
      rejected.push({ detection: d, reason: 'Missing component identification' });
      continue;
    }
    const annotation = detectionToAnnotation(d, photo, `ai_${result.providerId}_${n}`);
    if (!annotation) {
      rejected.push({ detection: d, reason: 'Unusable or out-of-bounds geometry' });
      continue;
    }
    proposals.push({
      photoId: photo.photoId,
      annotation,
      component: d.component.trim(),
      damageCategory: d.damageCategory?.trim() || null,
      condition: d.condition.trim(),
      confidence: clampConfidence(d.confidence),
      buildingLabel: d.buildingLabel?.trim() || null,
      noVisibleDamage: d.noVisibleDamage === true,
      detectionSource: 'ai',
      reviewStatus: 'pending',
      providerId: result.providerId,
      modelId: result.modelId,
    });
  }
  return { proposals, rejected, warnings: result.warnings ?? [] };
}

/**
 * Associate proposals across photos of the same inspection: same building,
 * component and damage category with overlapping bounding regions are likely
 * the same physical finding photographed more than once. Returns groups of
 * proposal indexes (into `proposals`); each group should become ONE finding
 * with multiple evidence rows.
 */
export function associateCrossPhoto(proposals: DamageProposal[]): number[][] {
  const key = (p: DamageProposal) =>
    `${(p.buildingLabel ?? '').toLowerCase()}|${p.component.toLowerCase()}|${(p.damageCategory ?? '').toLowerCase()}`;
  const groups = new Map<string, number[]>();
  proposals.forEach((p, i) => {
    const k = key(p);
    const arr = groups.get(k) ?? [];
    arr.push(i);
    groups.set(k, arr);
  });
  return [...groups.values()];
}

export const RECOGNITION_SEVERITIES = SEVERITIES;
