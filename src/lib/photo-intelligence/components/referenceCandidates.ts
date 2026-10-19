/**
 * Tenant-scoped reference labeling over EXISTING company photos.
 * Originals are read via signed URLs and never copied or modified.
 * Rep-selected photo categories are never used as labels.
 */
import { supabase } from '@/integrations/supabase/client';
import { loadImageForAnalysis } from '../patternAnalysis';
import { contentHashOf, dinoFeaturesForImage, poolRegionEmbedding } from './regionEmbedding';
import { loadDinoSession } from './onnxModel';
import type { ReferenceClass, VersionedReferenceLibrary } from './referenceClassifier';
import { normalizeEmbedding } from './referenceClassifier';
import type { CalibrationExample } from './calibration';
import { parseAnnotationSet } from '../annotations';

const MODEL = 'dinov2-small';

export interface InventoryPhoto { id: string; url: string | null; propertyKey: string; fileName: string | null }

export function propertyKeyOf(r: { lead_id: string | null; project_id: string | null; contact_id: string | null }): string {
  return r.lead_id ? `lead:${r.lead_id}` : r.project_id ? `project:${r.project_id}` : r.contact_id ? `contact:${r.contact_id}` : 'unassigned';
}

export async function inventoryCompanyPhotos(tenantId: string, limit = 200): Promise<InventoryPhoto[]> {
  const { data, error } = await (supabase.from as any)('customer_photos')
    .select('id, file_url, file_name, lead_id, project_id, contact_id, mime_type')
    .eq('tenant_id', tenantId).order('uploaded_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []).filter((r: any) => !r.mime_type || String(r.mime_type).startsWith('image/'));
  const pathOf = (r: any): string | null => {
    const m = '/customer-photos/';
    if (r.file_url?.includes(m)) return decodeURIComponent(r.file_url.split(m)[1].split('?')[0]);
    return r.file_name?.includes('/') ? r.file_name : null;
  };
  const paths = rows.map(pathOf).filter(Boolean) as string[];
  const { data: signed } = paths.length ? await supabase.storage.from('customer-photos').createSignedUrls(paths, 3600) : { data: [] as any[] };
  const byPath = new Map((signed ?? []).filter((s: any) => s.signedUrl).map((s: any) => [s.path, s.signedUrl]));
  return rows.map((r: any) => ({ id: r.id, url: (pathOf(r) && byPath.get(pathOf(r)!)) || null, propertyKey: propertyKeyOf(r), fileName: r.file_name }));
}

/** Embed each labeled polygon from the ORIGINAL photo with one DINOv2 pass, then store as pending candidates. */
export type ComponentCondition = 'normal' | 'possible_damage' | 'maintenance' | 'uncertain';
export async function saveReferenceCrops(tenantId: string, photo: InventoryPhoto, annotationJson: unknown, conditions: Record<string, ComponentCondition> = {}): Promise<number> {
  if (!photo.url) throw new Error('Photo cannot be opened.');
  const regions = parseAnnotationSet(annotationJson).flatMap((a: any) => {
    if (!a.damageCategory) return [];
    if (a.kind === 'polygon') return [{ id: a.id, cls: a.damageCategory, poly: a.points }];
    if (a.kind === 'bbox') return [{ id: a.id, cls: a.damageCategory, poly: [a.origin, { x: a.origin.x + a.size.x, y: a.origin.y }, { x: a.origin.x + a.size.x, y: a.origin.y + a.size.y }, { x: a.origin.x, y: a.origin.y + a.size.y }] }];
    return [];
  });
  if (!regions.length) throw new Error('Draw at least one labeled outline.');
  const dino = await loadDinoSession();
  if (!dino) throw new Error('The local DINOv2 model could not load in this browser.');
  const img = await loadImageForAnalysis(photo.url, 512);
  const features = await dinoFeaturesForImage(img, dino);
  if (!features) throw new Error('Embedding failed.');
  const hash = contentHashOf(img);
  const rows = regions.map((r) => {
    const emb = poolRegionEmbedding(features, r.poly);
    if (!emb) throw new Error(`A ${r.cls.replace(/_/g, ' ')} outline is too small to embed — draw it larger.`);
    return { tenant_id: tenantId, source_photo_id: photo.id, source_property_key: photo.propertyKey, cls: r.cls, polygon: r.poly, image_hash: hash, embedding: Array.from(normalizeEmbedding(emb)), embedding_model_id: MODEL, condition: conditions[r.id] ?? null };
  });
  const { error } = await (supabase.from as any)('photo_reference_candidates').insert(rows);
  if (error) throw error;
  return rows.length;
}

export interface ReferenceCandidate { id: string; source_photo_id: string; source_property_key: string; cls: string; labeled_by: string; approved_by: string | null; created_at: string; condition?: string | null; review_status?: string; review_comment?: string | null }

export async function loadCandidates(tenantId: string): Promise<(ReferenceCandidate & { embedding: number[] })[]> {
  const { data, error } = await (supabase.from as any)('photo_reference_candidates')
    .select('id, source_photo_id, source_property_key, cls, labeled_by, approved_by, created_at, embedding, condition, review_status, review_comment')
    .eq('tenant_id', tenantId).eq('embedding_model_id', MODEL).order('created_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function approveCandidate(id: string, userId: string, comment?: string) {
  const { error } = await (supabase.from as any)('photo_reference_candidates').update({ approved_by: userId, approved_at: new Date().toISOString(), review_comment: comment?.trim() || null }).eq('id', id).is('approved_by', null);
  if (error) throw error;
}

export function approvedToExamples(rows: (ReferenceCandidate & { embedding: number[] })[]): CalibrationExample[] {
  return rows.filter((r) => r.approved_by && (r.review_status ?? 'approved') === 'approved' && Array.isArray(r.embedding) && r.embedding.length).map((r) => ({
    id: r.id, cls: r.cls as ReferenceClass, embedding: Float32Array.from(r.embedding.map(Number)), libraryVersion: 1,
    sourcePhotoId: r.source_photo_id, sourceRegionId: r.id, approvedBy: r.approved_by!, propertyKey: r.source_property_key,
  }));
}

/** This company's active library: approved examples only. */
export async function loadTenantLibrary(tenantId: string): Promise<VersionedReferenceLibrary> {
  try { return { version: 1, embeddingModelId: MODEL, examples: approvedToExamples(await loadCandidates(tenantId)) }; }
  catch { return { version: 1, embeddingModelId: MODEL, examples: [] }; }
}

export type ReviewAction = 'approved' | 'rejected' | 'needs_correction';
/** Independent review via the server function: blocks self-review, other companies and re-review; reject/correction need a reason; every action is logged. */
export async function reviewCandidate(id: string, action: ReviewAction, reason?: string) {
  if (action !== 'approved' && !reason?.trim()) throw new Error('A reason is required to reject or request a correction.');
  const { error } = await (supabase.rpc as any)('review_reference_candidate', { _id: id, _action: action, _reason: reason?.trim() || null });
  if (error) throw error;
}
