/**
 * Reproducible model evaluation, reported per roof system and per class:
 * precision, recall, FP, FN, mean IoU, calibration (ECE). Refuses to score
 * photos that were in the training split.
 */
import type { DatasetVersion } from './dataset';

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
  photosEvaluated: number;
  bySystem: Record<string, Record<string, ClassMetrics>>;
  /** Expected calibration error over all predictions (10 bins). */
  ece: number | null;
}

export function evaluate(ds: DatasetVersion, preds: Prediction[], iouThreshold = 0.5): EvaluationReport {
  const val = ds.photos.filter((p) => ds.split[p.photoId] === 'val');
  const valIds = new Set(val.map((p) => p.photoId));
  const leaked = preds.find((p) => !valIds.has(p.photoId));
  if (leaked) throw new Error(`Prediction on non-validation photo ${leaked.photoId}; training photos cannot be used to claim accuracy`);

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
  return { datasetVersion: ds.version, photosEvaluated: val.length, bySystem, ece };
}

/** A class is promotable only with enough validation support and passing P/R. */
export function promotableClasses(r: EvaluationReport, minSupport = 30, minPrecision = 0.9, minRecall = 0.9): string[] {
  const out: string[] = [];
  for (const [s, classes] of Object.entries(r.bySystem)) for (const [c, m] of Object.entries(classes)) {
    if (m.tp + m.fn >= minSupport && (m.precision ?? 0) >= minPrecision && (m.recall ?? 0) >= minRecall) out.push(`${s}:${c}`);
  }
  return out;
}
