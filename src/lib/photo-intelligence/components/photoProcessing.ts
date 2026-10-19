/**
 * Persisted photo processing for a company's existing photos. Runs in the
 * signed-in user's browser with their own permissions (RLS + signed URLs),
 * so company isolation and storage rules are never bypassed. Results and
 * outline proposals are saved so nobody has to repeat the work.
 */
import { supabase } from '@/integrations/supabase/client';
import { assessQuality, loadImageForAnalysis } from '../patternAnalysis';
import { differenceHash, markDuplicates, type TriagedPhoto } from './photoTriage';
import { proposeRegions, type RegionSuggestion } from './regionProposals';
import type { VersionedReferenceLibrary } from './referenceClassifier';
import type { InventoryPhoto } from './referenceCandidates';

export async function loadTriage(tenantId: string): Promise<TriagedPhoto[]> {
  const { data, error } = await (supabase.from as any)('photo_triage_results').select('photo_id, property_key, dhash, sharpness, assessable, issues').eq('tenant_id', tenantId).limit(5000);
  if (error) throw error;
  return markDuplicates((data ?? []).map((r: any) => ({ id: r.photo_id, propertyKey: r.property_key, hash: r.dhash, sharpness: r.sharpness, assessable: r.assessable, issues: r.issues ?? [], duplicateOf: null })));
}

/** Check every not-yet-checked photo; saves each result as it goes. */
export async function runTriage(tenantId: string, photos: InventoryPhoto[], done: Set<string>, onProgress: (n: number, total: number) => void) {
  const todo = photos.filter((p) => !done.has(p.id));
  let n = 0;
  for (const p of todo) {
    const t0 = performance.now();
    let row: any = { photo_id: p.id, tenant_id: tenantId, property_key: p.propertyKey, assessable: false, issues: ['Photo could not be opened'] };
    if (p.url) {
      try {
        const img = await loadImageForAnalysis(p.url, 256);
        const q = assessQuality(img);
        row = { ...row, dhash: differenceHash(img), sharpness: q.sharpness, brightness: q.brightness, assessable: q.assessable, issues: q.issues };
      } catch { /* keep could-not-open */ }
    }
    row.processing_ms = Math.round(performance.now() - t0);
    const { error } = await (supabase.from as any)('photo_triage_results').upsert(row);
    if (error) throw error;
    onProgress(++n, todo.length);
  }
}

export interface SavedProposal { id: string; source_photo_id: string; polygon: { x: number; y: number }[]; group_index: number; suggestion: RegionSuggestion['suggestion'] | null; status: string; timings_ms: Record<string, number> | null }

export async function loadProposals(tenantId: string): Promise<SavedProposal[]> {
  const { data, error } = await (supabase.from as any)('photo_region_proposals').select('id, source_photo_id, polygon, group_index, suggestion, status, timings_ms').eq('tenant_id', tenantId).limit(10000);
  if (error) throw error;
  return data ?? [];
}

/** Propose outlines for each photo in turn and save them as unverified drafts. Returns per-photo total ms. */
export async function runProposalBatch(tenantId: string, photos: InventoryPhoto[], library: VersionedReferenceLibrary, onProgress: (n: number, total: number) => void): Promise<number[]> {
  const times: number[] = [];
  for (const p of photos) {
    if (!p.url) continue;
    const t0 = performance.now();
    const r = await proposeRegions(p.url, library);
    times.push(performance.now() - t0);
    if (r.regions.length) {
      const rows = r.regions.map((g) => ({ id: g.id, tenant_id: tenantId, source_photo_id: p.id, property_key: p.propertyKey, polygon: g.polygon, group_index: g.group, suggestion: g.suggestion, segmenter_model: r.models.segmenter, embedder_model: r.models.embedder, timings_ms: r.timingsMs }));
      const { error } = await (supabase.from as any)('photo_region_proposals').insert(rows);
      if (error) throw error;
    }
    onProgress(times.length, photos.length);
  }
  return times;
}

export const p95 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
