/**
 * Phase 4 real-photo benchmark harness.
 *
 * Stores ORIGINAL, unannotated roof photographs with inspector-drawn
 * component reference labels, per company, separated by property. An item
 * only counts as benchmark evidence after an independent reviewer (not the
 * labeler) approves it — the database enforces that. Scoring runs through
 * `scoreComponentClassification`, which is explicitly the experimental
 * reference-classifier benchmark and is reported separately from any damage
 * recognition metrics.
 */

import { supabase } from '@/integrations/supabase/client';
import { scoreComponentClassification, type BenchmarkDetection, type BenchmarkPhoto } from './benchmark';

export interface BenchmarkSet {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface BenchmarkItem {
  id: string;
  set_id: string;
  storage_path: string;
  property_key: string;
  material: string;
  scene_kind: 'intact' | 'damaged' | 'shadowed' | 'repair' | 'debris' | 'maintenance';
  component_labels: BenchmarkDetection[];
  labels_reviewed: boolean;
  labeled_by: string;
  reviewed_by: string | null;
  url: string | null;
}

const BUCKET = 'canvass-photos';

export async function loadBenchmarkSets(tenantId: string): Promise<BenchmarkSet[]> {
  const { data, error } = await (supabase.from as any)('photo_benchmark_sets')
    .select('id, tenant_id, name, description, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createBenchmarkSet(tenantId: string, name: string, description: string): Promise<void> {
  const { error } = await (supabase.from as any)('photo_benchmark_sets').insert({ tenant_id: tenantId, name, description });
  if (error) throw new Error(error.message);
}

export async function loadBenchmarkItems(setId: string): Promise<BenchmarkItem[]> {
  const { data, error } = await (supabase.from as any)('photo_benchmark_items')
    .select('id, set_id, storage_path, property_key, material, scene_kind, component_labels, labels_reviewed, labeled_by, reviewed_by')
    .eq('set_id', setId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({ ...row, url: null as string | null }));
}

export async function addBenchmarkPhoto(input: {
  tenantId: string;
  setId: string;
  propertyKey: string;
  material: string;
  sceneKind: BenchmarkItem['scene_kind'];
  file: File;
  labeledBy: string;
}): Promise<void> {
  const path = `${input.tenantId}/photo-benchmark/${input.setId}/${crypto.randomUUID()}-${input.file.name}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, { upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { error } = await (supabase.from as any)('photo_benchmark_items').insert({
    set_id: input.setId,
    tenant_id: input.tenantId,
    storage_path: path,
    property_key: input.propertyKey,
    material: input.material,
    scene_kind: input.sceneKind,
    labeled_by: input.labeledBy,
  });
  if (error) throw new Error(error.message);
}

/** Save inspector-drawn component boxes (normalized 0–1). Only the labeler may edit before review; labels stay drafts until independently reviewed. */
export async function saveBenchmarkLabels(itemId: string, labels: BenchmarkDetection[]): Promise<void> {
  const { error } = await (supabase.from as any)('photo_benchmark_items')
    .update({ component_labels: labels.map((l) => ({ ...l, photoId: itemId })), labels_reviewed: false, reviewed_by: null, reviewed_at: null })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}

/** Independent review — the database rejects self-review. */
export async function reviewBenchmarkItem(itemId: string, reviewerId: string): Promise<void> {
  const { error } = await (supabase.from as any)('photo_benchmark_items')
    .update({ labels_reviewed: true, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}

/**
 * Score a set against predictions (e.g. imported from an analysis run).
 * Only independently reviewed items are scored; property coverage is
 * reported so results can be separated by property. Throws when the set
 * has no reviewed items — no numbers from unreviewed labels, ever.
 */
export function scoreBenchmarkSet(
  items: BenchmarkItem[],
  predictions: BenchmarkDetection[],
  iouThreshold = 0.5,
) {
  const reviewed = items.filter((i) => i.labels_reviewed && i.reviewed_by);
  if (!reviewed.length) throw new Error('No independently reviewed benchmark photos yet.');
  const photos: BenchmarkPhoto[] = reviewed.map((i) => ({ photoId: i.id, input: 'unannotated_original', labelsReviewed: true }));
  const labels: BenchmarkDetection[] = reviewed.flatMap((i) =>
    (i.component_labels ?? []).filter((l) => l.photoId === i.id || !l.photoId).map((l) => ({ ...l, photoId: i.id })),
  );
  const result = scoreComponentClassification(photos, labels, predictions, iouThreshold);
  return {
    ...result,
    properties: new Set(reviewed.map((i) => i.property_key)).size,
    photosEvaluated: reviewed.length,
    bySceneKind: [...new Set(reviewed.map((i) => i.scene_kind))].map((kind) => ({
      kind,
      photos: reviewed.filter((i) => i.scene_kind === kind).length,
    })),
  };
}
