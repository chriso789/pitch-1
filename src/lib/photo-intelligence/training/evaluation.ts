/**
 * Reproducible model evaluation, reported per roof system and per class:
 * precision, recall, FP, FN, mean IoU, calibration (ECE). Refuses to score
 * photos that were in the training split.
 */
import type { DatasetVersion } from './dataset';
import { isValidClassForSystem, isTrainableClass, conditionKind, type ConditionKind } from './taxonomy';
import { isLearningPhoto } from './conditions';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Prediction { photoId: string; cls: string; box: Box; confidence: number }

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return u > 0 ? inter / u : 0;
}

export interface ClassMetrics { tp: number; fp: number; fn: number; precision: number | null; recall: number | null; meanIoU: number | null }

export interface EvaluationReport {
  datasetVersion: string;
  partition: 'val' | 'test';
  photosEvaluated: number;
  bySystem: Record<string, Record<string, ClassMetrics>>;
  /** Expected calibration error over all predictions (10 bins). */
  ece: number | null;
  byCondition: Partial<Record<ConditionKind, ClassMetrics>>;
  damageFalsePositivesOnNormalPhotos: number;
  normalPhotosEvaluated: number;
  reviewOnlyPhotos: number;
}

export function evaluate(ds: DatasetVersion, preds: Prediction[], iouThreshold = 0.5, partition: 'val' | 'test' = 'val'): EvaluationReport {
  if (!Number.isFinite(iouThreshold) || iouThreshold <= 0 || iouThreshold > 1) throw new Error('Invalid IoU threshold');
  const properties = new Map<string, string>();
  for (const p of ds.photos) {
    const previous = properties.get(p.propertyId);
    if (previous && previous !== ds.split[p.photoId]) throw new Error('Property leakage between dataset partitions');
    properties.set(p.propertyId, ds.split[p.photoId]);
  }
  const partitionPhotos = ds.photos.filter((p) => ds.split[p.photoId] === partition);
  const val = partitionPhotos.filter(isLearningPhoto);
  const valIds = new Set(val.map((p) => p.photoId));
  const leaked = preds.find((p) => !valIds.has(p.photoId));
  if (leaked) throw new Error(`Prediction on non-validation photo ${leaked.photoId}; training photos cannot be used to claim accuracy`);
  for (const pr of preds) {
    const p = val.find((v) => v.photoId === pr.photoId);
    const b = pr.box;
    if (!p || !isTrainableClass(pr.cls) || !isValidClassForSystem(p.roofSystem, pr.cls) || !Number.isFinite(pr.confidence) || pr.confidence < 0 || pr.confidence > 1 || !Object.values(b).every(Number.isFinite) || b.x0 < 0 || b.y0 < 0 || b.x1 > 1 || b.y1 > 1 || b.x1 <= b.x0 || b.y1 <= b.y0) throw new Error('Invalid prediction');
  }

  const bySystem: EvaluationReport['bySystem'] = {};
  const acc: Record<string, Record<string, { tp: number; fp: number; fn: number; ious: number[] }>> = {};
  const calib: { c: number; hit: boolean }[] = [];
  const slot = (s: string, c: string) => ((acc[s] ??= {})[c] ??= { tp: 0, fp: 0, fn: 0, ious: [] });

  for (const p of val) {
    const gts = p.regions.map((r) => {
      const xs = r.polygon.map((q) => q.x), ys = r.polygon.map((q) => q.y);
      return { cls: r.cls, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, used: false };
    });
    const mine = preds.filter((x) => x.photoId === p.photoId).sort((a, b) => b.confidence - a.confidence);
    for (const pr of mine) {
      let best = -1, bestIoU = 0;
      gts.forEach((g, i) => { if (!g.used && g.cls === pr.cls) { const v = iou(g.box, pr.box); if (v > bestIoU) { bestIoU = v; best = i; } } });
      const m = slot(p.roofSystem, pr.cls);
      const hit = best >= 0 && bestIoU >= iouThreshold;
      if (hit) { gts[best].used = true; m.tp++; m.ious.push(bestIoU); } else m.fp++;
      calib.push({ c: pr.confidence, hit });
    }
    for (const g of gts) if (!g.used) slot(p.roofSystem, g.cls).fn++;
  }
  for (const [s, classes] of Object.entries(acc)) {
    bySystem[s] = {};
    for (const [c, m] of Object.entries(classes)) bySystem[s][c] = {
      tp: m.tp, fp: m.fp, fn: m.fn,
      precision: m.tp + m.fp ? m.tp / (m.tp + m.fp) : null,
      recall: m.tp + m.fn ? m.tp / (m.tp + m.fn) : null,
      meanIoU: m.ious.length ? m.ious.reduce((a, b) => a + b, 0) / m.ious.length : null,
    };
  }
  let ece: number | null = null;
  if (calib.length) {
    ece = 0;
    for (let b = 0; b < 10; b++) {
      const bin = calib.filter((x) => Math.min(9, Math.floor(x.c * 10)) === b);
      if (!bin.length) continue;
      const conf = bin.reduce((a, x) => a + x.c, 0) / bin.length;
      const accu = bin.filter((x) => x.hit).length / bin.length;
      ece += (bin.length / calib.length) * Math.abs(conf - accu);
    }
  }
  const byCondition: EvaluationReport['byCondition'] = {};
  for (const classes of Object.values(acc)) for (const [cls, m] of Object.entries(classes)) {
    const kind = conditionKind(cls);
    const v = byCondition[kind] ?? { tp: 0, fp: 0, fn: 0, precision: null, recall: null, meanIoU: null };
    v.tp += m.tp; v.fp += m.fp; v.fn += m.fn;
    v.precision = v.tp + v.fp ? v.tp / (v.tp + v.fp) : null;
    v.recall = v.tp + v.fn ? v.tp / (v.tp + v.fn) : null;
    byCondition[kind] = v;
  }
  const normal = val.filter((p) => p.noVisibleDamage || (p.regions.length > 0 && p.regions.every((r) => conditionKind(r.cls) === 'normal')));
  const normalIds = new Set(normal.map((p) => p.photoId));
  return { datasetVersion: ds.version, partition, photosEvaluated: val.length, bySystem, ece, byCondition,
    damageFalsePositivesOnNormalPhotos: preds.filter((p) => normalIds.has(p.photoId) && conditionKind(p.cls) === 'damage').length,
    normalPhotosEvaluated: normal.length, reviewOnlyPhotos: partitionPhotos.length - val.length };

}

/** A class is promotable only with enough validation support and passing P/R. */
export function promotableClasses(r: EvaluationReport, minSupport = 30, minPrecision = 0.9, minRecall = 0.9): string[] {
  const out: string[] = [];
  if (r.partition !== 'test') return out;
  for (const [s, classes] of Object.entries(r.bySystem)) for (const [c, m] of Object.entries(classes)) {
    if (m.tp + m.fn >= minSupport && (m.precision ?? 0) >= minPrecision && (m.recall ?? 0) >= minRecall) out.push(`${s}:${c}`);
  }
  return out;
}
