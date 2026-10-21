/**
 * Automatic component-region proposals for reference labeling.
 * SAM 2.1 proposes unlabeled outlines; DINOv2 embeds each one; the company's
 * approved library may SUGGEST a class with its runner-up. Suggestions are
 * written only into notes — never into the label — so nothing becomes a
 * label until an inspector assigns it and a second inspector approves it.
 */
import { loadImageForAnalysis, analyzePattern } from '../patternAnalysis';
import { loadComponentModel, loadDinoSession } from './onnxModel';
import { dinoFeaturesForImage, poolRegionEmbedding } from './regionEmbedding';
import { classifyRegion, cosineSimilarity, normalizeEmbedding, type ClassificationThresholds, type VersionedReferenceLibrary } from './referenceClassifier';
import type { Annotation } from '../annotations';

export interface RegionSuggestion {
  id: string;
  polygon: { x: number; y: number }[];
  embedding: Float32Array | null;
  suggestion: { kind: 'component' | 'hard_negative' | 'unknown'; cls: string | null; similarity: number | null; margin: number | null; runnerUp: { cls: string; similarity: number } | null };
  /** Index of the visually-similar group within this photo (same group ⇒ likely same surface type). */
  group: number;
}

export interface ProposalReport {
  imageSize?: { width: number; height: number };
  regions: RegionSuggestion[];
  anomalies: { polygon: { x: number; y: number }[]; condition: string }[];
  timingsMs: Record<'decode' | 'segment' | 'embed' | 'classify' | 'anomaly', number>;
  models: { segmenter: string | null; embedder: string | null; libraryVersion: number; libraryExamples: number };
  warnings: string[];
}

/** Best similarity per class, sorted. */
export function rankClasses(emb: Float32Array, lib: VersionedReferenceLibrary): { cls: string; similarity: number }[] {
  const q = normalizeEmbedding(emb);
  const best = new Map<string, number>();
  for (const ex of lib.examples) { const s = cosineSimilarity(q, ex.embedding); if (s > (best.get(ex.cls) ?? -2)) best.set(ex.cls, s); }
  return [...best].map(([cls, similarity]) => ({ cls, similarity })).sort((a, b) => b.similarity - a.similarity);
}

/** Greedy cosine grouping: regions joining a group must be ≥ `minSim` to its first member. */
export function groupBySimilarity(embs: (Float32Array | null)[], minSim = 0.85): number[] {
  const leaders: { idx: number; e: Float32Array }[] = [];
  return embs.map((e, i) => {
    if (!e) return -1;
    const n = normalizeEmbedding(e);
    const g = leaders.findIndex((l) => cosineSimilarity(l.e, n) >= minSim);
    if (g >= 0) return g;
    leaders.push({ idx: i, e: n });
    return leaders.length - 1;
  });
}

export async function proposeRegions(url: string, library: VersionedReferenceLibrary, thresholds?: ClassificationThresholds): Promise<ProposalReport> {
  const t = { decode: 0, segment: 0, embed: 0, classify: 0, anomaly: 0 };
  const warnings: string[] = [];
  let t0 = performance.now();
  const img = await loadImageForAnalysis(url, 512);
  t.decode = performance.now() - t0;

  t0 = performance.now();
  const seg = await loadComponentModel();
  const segRegions = seg && seg.modelId.startsWith('sam') ? await seg.segment(img) : [];
  if (!seg || !seg.modelId.startsWith('sam')) warnings.push('The local segmentation model did not load; draw outlines manually.');
  t.segment = performance.now() - t0;

  t0 = performance.now();
  const dino = await loadDinoSession();
  const features = dino ? await dinoFeaturesForImage(img, dino) : null;
  if (!features) warnings.push('The local DINOv2 model did not load; no suggestions or grouping.');
  const embs = segRegions.map((r) => (features ? poolRegionEmbedding(features, r.polygonNorm) : null));
  t.embed = performance.now() - t0;

  t0 = performance.now();
  const groups = groupBySimilarity(embs);
  const regions: RegionSuggestion[] = segRegions.map((r, i) => {
    const e = embs[i];
    let suggestion: RegionSuggestion['suggestion'] = { kind: 'unknown', cls: null, similarity: null, margin: null, runnerUp: null };
    if (e && library.examples.length) {
      const c = classifyRegion(e, library, thresholds);
      const ranked = rankClasses(e, library);
      const top = ranked[0];
      const runner = ranked.find((x) => x.cls !== (c.kind === 'unknown' ? top?.cls : c.cls)) ?? null;
      suggestion = c.kind === 'unknown'
        ? { kind: 'unknown', cls: null, similarity: top?.similarity ?? null, margin: null, runnerUp: top ?? null }
        : { kind: c.kind, cls: c.cls, similarity: c.similarity, margin: c.margin, runnerUp: runner };
    }
    return { id: crypto.randomUUID(), polygon: r.polygonNorm, embedding: e, suggestion, group: groups[i] };
  });
  t.classify = performance.now() - t0;

  t0 = performance.now();
  const pattern = analyzePattern(img);
  const anomalies = pattern.result.detections.filter((d) => d.polygonNorm).map((d) => ({ polygon: d.polygonNorm!, condition: d.condition ?? '' }));
  t.anomaly = performance.now() - t0;

  return { regions, anomalies, imageSize: { width: img.width, height: img.height }, timingsMs: t, models: { segmenter: seg?.modelId ?? null, embedder: features?.modelId ?? null, libraryVersion: library.version, libraryExamples: library.examples.length }, warnings };
}

/** Convert proposals into UNLABELED editable outlines; any suggestion lives only in notes. */
export function proposalsToAnnotations(regions: RegionSuggestion[]): Annotation[] {
  return regions.map((r) => ({
    id: r.id, kind: 'polygon', points: r.polygon, color: '#38bdf8', damageCategory: null,
    notes: r.suggestion.cls
      ? `Unverified suggestion: resembles ${r.suggestion.cls.replace(/_/g, ' ')} (similarity ${r.suggestion.similarity?.toFixed(2)}${r.suggestion.runnerUp ? `, next ${r.suggestion.runnerUp.cls.replace(/_/g, ' ')} ${r.suggestion.runnerUp.similarity.toFixed(2)}` : ''}). Group ${r.group + 1}.`
      : `Proposed outline, component unknown. Group ${r.group + 1}.`,
  }) as Annotation);
}
