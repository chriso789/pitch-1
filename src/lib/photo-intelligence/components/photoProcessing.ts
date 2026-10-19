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

export type RunStatus = 'completed' | 'no_useful_regions' | 'unassessable' | 'failed';
export interface PhotoRunResult { photoId: string; status: RunStatus; widthPx: number | null; heightPx: number | null; regionCount: number; invalidRegionCount: number; durationMs: number; error: string | null }

/** A polygon is usable only with >=3 finite points inside the image and a non-trivial area. */
export function isValidPolygon(poly: { x: number; y: number }[]): boolean {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  if (!poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
  let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2 >= 0.0005;
}

export function classifyRun(o: { assessable: boolean | null; error: string | null; segmenterLoaded: boolean; validRegions: number }): RunStatus {
  if (o.error || !o.segmenterLoaded) return 'failed';
  if (o.assessable === false) return 'unassessable';
  return o.validRegions > 0 ? 'completed' : 'no_useful_regions';
}

/** Propose outlines photo by photo; saves only valid polygons and logs a status row per photo. */
export async function runProposalBatch(tenantId: string, photos: InventoryPhoto[], library: VersionedReferenceLibrary, onProgress: (n: number, total: number) => void, assessable: Map<string, boolean> = new Map()): Promise<PhotoRunResult[]> {
  const out: PhotoRunResult[] = [];
  for (const p of photos) {
    const t0 = performance.now();
    let res: PhotoRunResult = { photoId: p.id, status: 'failed', widthPx: null, heightPx: null, regionCount: 0, invalidRegionCount: 0, durationMs: 0, error: null };
    let segmenter: string | null = null;
    try {
      if (!p.url) throw new Error('Photo could not be opened');
      const r = await proposeRegions(p.url, library);
      segmenter = r.models.segmenter;
      const valid = r.regions.filter((g) => isValidPolygon(g.polygon));
      res = { ...res, widthPx: r.imageSize?.width ?? null, heightPx: r.imageSize?.height ?? null, regionCount: valid.length, invalidRegionCount: r.regions.length - valid.length };
      res.status = classifyRun({ assessable: assessable.get(p.id) ?? null, error: null, segmenterLoaded: !!segmenter?.startsWith('sam'), validRegions: valid.length });
      if (!segmenter?.startsWith('sam')) res.error = r.warnings.join(' ') || 'Segmentation model did not load';
      if (valid.length) {
        const rows = valid.map((g) => ({ id: g.id, tenant_id: tenantId, source_photo_id: p.id, property_key: p.propertyKey, polygon: g.polygon, group_index: g.group, suggestion: g.suggestion, segmenter_model: r.models.segmenter, embedder_model: r.models.embedder, timings_ms: r.timingsMs }));
        const { error } = await (supabase.from as any)('photo_region_proposals').insert(rows);
        if (error) throw error;
      }
    } catch (e) { res.status = 'failed'; res.error = (e as Error).message || 'Unknown error'; }
    res.durationMs = Math.round(performance.now() - t0);
    await (supabase.from as any)('photo_proposal_runs').insert({ tenant_id: tenantId, source_photo_id: p.id, status: res.status, width_px: res.widthPx, height_px: res.heightPx, region_count: res.regionCount, invalid_region_count: res.invalidRegionCount, duration_ms: res.durationMs, error: res.error, segmenter_model: segmenter });
    out.push(res);
    onProgress(out.length, photos.length);
  }
  return out;
}

export async function loadRuns(tenantId: string): Promise<PhotoRunResult[]> {
  const { data, error } = await (supabase.from as any)('photo_proposal_runs').select('source_photo_id, status, width_px, height_px, region_count, invalid_region_count, duration_ms, error, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  const seen = new Set<string>();
  return (data ?? []).filter((r: any) => !seen.has(r.source_photo_id) && seen.add(r.source_photo_id)).map((r: any) => ({ photoId: r.source_photo_id, status: r.status, widthPx: r.width_px, heightPx: r.height_px, regionCount: r.region_count, invalidRegionCount: r.invalid_region_count, durationMs: r.duration_ms, error: r.error }));
}

export const p95 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
