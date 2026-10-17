/**
 * Photo Intelligence live analysis orchestration (Phase 2 wiring).
 *
 * Loads a record's photos, runs the existing `ai-image-analyzer` edge
 * function through the recognition adapter, validates every detection
 * (geometry-less or out-of-bounds candidates are rejected with reasons,
 * never placed), and persists proposals as review-pending findings.
 *
 * Hard rules preserved here:
 *  - Nothing is fabricated: only model-supplied coordinates become regions.
 *  - Every finding lands as detection_source 'ai' + review_status 'pending'.
 *  - Duplicate analysis of the same photo is skipped unless forced.
 */

import { supabase } from '@/integrations/supabase/client';
import { createAiImageAnalyzerProvider, type AiImageAnalyzerResponse } from './providers/aiImageAnalyzerProvider';
import { validateDetections, associateCrossPhoto, type DamageProposal, type RecognitionPhoto } from './recognition';
import { persistProposals } from './findings';

export interface RecordPhoto {
  id: string;
  file_url: string | null;
  file_name: string | null;
  lead_id: string | null;
  project_id: string | null;
  contact_id: string | null;
}

/** Load photos attached to a lead / project / contact, tenant-scoped. */
export async function loadRecordPhotos(
  tenantId: string,
  scope: { leadId?: string; projectId?: string; contactId?: string },
): Promise<RecordPhoto[]> {
  let q = (supabase.from as any)('customer_photos')
    .select('id, file_url, file_name, lead_id, project_id, contact_id')
    .eq('tenant_id', tenantId)
    .order('display_order', { ascending: true })
    .order('uploaded_at', { ascending: false });
  if (scope.leadId) q = q.eq('lead_id', scope.leadId);
  else if (scope.projectId) q = q.eq('project_id', scope.projectId);
  else if (scope.contactId) q = q.eq('contact_id', scope.contactId);
  else return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RecordPhoto[];
}

/** Storage paths / photo ids that already have analysis evidence — dedupe guard. */
export async function listAnalyzedPhotoIds(tenantId: string): Promise<Set<string>> {
  const { data, error } = await (supabase.from as any)('photo_finding_evidence')
    .select('photo_id')
    .eq('tenant_id', tenantId)
    .not('photo_id', 'is', null);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => String(r.photo_id)));
}

/** Live invoker: calls the existing ai-image-analyzer edge function (legacy
 * shim → ai-api /image/analyze). Returns bare analysis JSON, no envelope. */
async function invokeAnalyzer(body: { image_data: string; analysis_type: string; step_id: string; step_title: string }) {
  const { data, error } = await supabase.functions.invoke<AiImageAnalyzerResponse>('ai-image-analyzer', { body });
  if (error) return { data: null, error: { message: error.message ?? 'invoke_failed' } };
  if (!data) return { data: null, error: { message: 'empty_response' } };
  if ((data as any).error) return { data: null, error: { message: String((data as any).error) } };
  return { data, error: null };
}

/** Fetch a photo and return a data URL for the vision request. */
async function photoToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
  const blob = await res.blob();
  if (blob.size > 15 * 1024 * 1024) throw new Error('Photo too large to analyze (>15MB)');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read photo'));
    reader.readAsDataURL(blob);
  });
}

export interface AnalysisProgress {
  total: number;
  done: number;
  currentFile?: string;
  errors: { photoId: string; fileName: string; message: string }[];
  skippedDuplicates: number;
  proposals: number;
  rejectedCandidates: number;
}

export interface AnalysisOutcome {
  findingsCreated: number;
  proposals: number;
  rejectedCandidates: number;
  errors: { photoId: string; fileName: string; message: string }[];
  skippedDuplicates: number;
  warnings: string[];
}

/**
 * Analyze the given photos and persist review-pending findings.
 * `force: false` skips photos that already have analysis evidence.
 */
export async function analyzeRecordPhotos(
  tenantId: string,
  userId: string,
  photos: RecordPhoto[],
  opts: {
    projectId?: string | null;
    force?: boolean;
    onProgress?: (p: AnalysisProgress) => void;
  } = {},
): Promise<AnalysisOutcome> {
  const provider = createAiImageAnalyzerProvider(invokeAnalyzer);
  const already = opts.force ? new Set<string>() : await listAnalyzedPhotoIds(tenantId);
  const queue = photos.filter((p) => !already.has(p.id));
  const skippedDuplicates = photos.length - queue.length;

  const progress: AnalysisProgress = {
    total: queue.length, done: 0, errors: [], skippedDuplicates, proposals: 0, rejectedCandidates: 0,
  };
  const emit = () => opts.onProgress?.({ ...progress, errors: [...progress.errors] });

  const allProposals: DamageProposal[] = [];
  const warnings: string[] = [];

  for (const photo of queue) {
    progress.currentFile = photo.file_name ?? photo.id;
    emit();
    try {
      if (!photo.file_url) throw new Error('Photo has no file URL');
      const dataUrl = await photoToDataUrl(photo.file_url);
      const recPhoto: RecognitionPhoto = { photoId: photo.id, imageRef: dataUrl };
      const result = await provider.analyze(recPhoto);
      const batch = validateDetections(result, recPhoto);
      allProposals.push(...batch.proposals);
      warnings.push(...batch.warnings.map((w) => `${photo.file_name ?? photo.id}: ${w}`));
      progress.proposals += batch.proposals.length;
      progress.rejectedCandidates += batch.rejected.length;
    } catch (e: any) {
      progress.errors.push({ photoId: photo.id, fileName: photo.file_name ?? photo.id, message: e?.message ?? 'Analysis failed' });
    }
    progress.done += 1;
    emit();
  }

  const groups = associateCrossPhoto(allProposals);
  const photoMeta = new Map(photos.map((p) => [p.id, { storagePath: null as string | null }]));
  const created = allProposals.length > 0
    ? await persistProposals(tenantId, allProposals, groups, photoMeta, userId, { projectId: opts.projectId ?? null })
    : [];

  return {
    findingsCreated: created.length,
    proposals: progress.proposals,
    rejectedCandidates: progress.rejectedCandidates,
    errors: progress.errors,
    skippedDuplicates,
    warnings,
  };
}
