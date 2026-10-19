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
import { analyzePattern, loadImageForAnalysis } from './patternAnalysis';
import { recognizeComponents, refineWithComponents, matchAnomaliesToRegions } from './components/componentRecognition';
import { loadComponentModel } from './components/onnxModel';

/** Flipped only once the self-hosted engine is deployed with validated weights. */
export const PITCH_VISION_ENGINE_READY = false;

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
  const rows = (data ?? []) as RecordPhoto[];
  // The customer-photos bucket is private: stored public URLs return 400.
  // Resolve each storage path to a short-lived signed URL instead.
  const paths = rows.map((r) => storagePathOf(r)).filter((p): p is string => !!p);
  if (paths.length === 0) return rows;
  const { data: signed } = await supabase.storage.from('customer-photos').createSignedUrls(paths, 3600);
  const byPath = new Map((signed ?? []).filter((s: any) => s.signedUrl).map((s: any) => [s.path, s.signedUrl as string]));
  return rows.map((r) => {
    const p = storagePathOf(r);
    return p && byPath.has(p) ? { ...r, file_url: byPath.get(p)! } : r;
  });
}

/** Storage object path inside the customer-photos bucket. */
function storagePathOf(r: RecordPhoto): string | null {
  const marker = '/customer-photos/';
  if (r.file_url && r.file_url.includes(marker)) {
    return decodeURIComponent(r.file_url.split(marker)[1].split('?')[0]);
  }
  if (r.file_name && r.file_name.includes('/')) return r.file_name;
  return null;
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
async function invokeAnalyzer(body: { image_data: string; analysis_type: string; step_id: string; step_title: string }): Promise<{ data: AiImageAnalyzerResponse | null; error: { message: string } | null }> {
  const { data, error } = await supabase.functions.invoke<AiImageAnalyzerResponse>('ai-image-analyzer', { body });
  if (error) return { data: null, error: { message: error.message ?? 'invoke_failed' } };
  if (!data) return { data: null, error: { message: 'empty_response' } };
  if ((data as any).error) return { data: null, error: { message: String((data as any).error) } };
  return { data: data as AiImageAnalyzerResponse, error: null };
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
  /** Photos analyzed successfully with nothing unusual (valid result, not a failure). */
  noUnusualRegions?: number;
  /** Photos that could not be assessed (blur, darkness, exposure). */
  notAssessable?: number;
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
  // PITCH owns its recognition engine: no external AI APIs. Until the
  // self-hosted engine (worker /vision/detect-damage) is deployed with
  // validated weights, analysis stops clearly instead of calling OpenAI.
  // Until then, PITCH's own pattern analysis (no training needed) proposes
  // possible-anomaly regions for inspector review — never confirmed damage.
  const provider = createAiImageAnalyzerProvider({ invoke: (body) => invokeAnalyzer(body) });
  const already = opts.force ? new Set<string>() : await listAnalyzedPhotoIds(tenantId);
  const queue = photos.filter((p) => !already.has(p.id));
  const skippedDuplicates = photos.length - queue.length;

  const progress: AnalysisProgress = {
    total: queue.length, done: 0, errors: [], skippedDuplicates, proposals: 0, rejectedCandidates: 0,
  };
  const emit = () => opts.onProgress?.({ ...progress, errors: [...progress.errors] });

  let noUnusualRegions = 0, notAssessable = 0;
  // Load any installed local component model once per run; null = not installed.
  const componentModel = await loadComponentModel();
  const similarityModel = await loadSimilarityModel();
  const allProposals: DamageProposal[] = [];
  const warnings: string[] = [];

  for (const photo of queue) {
    progress.currentFile = photo.file_name ?? photo.id;
    emit();
    try {
      if (!photo.file_url) throw new Error('Photo has no file URL');
      let recPhoto: RecognitionPhoto;
      let result;
      if (PITCH_VISION_ENGINE_READY) {
        recPhoto = { photoId: photo.id, imageRef: await photoToDataUrl(photo.file_url) };
        result = await provider.analyze(recPhoto);
      } else {
        const img = await loadImageForAnalysis(photo.file_url);
        recPhoto = { photoId: photo.id, imageRef: photo.file_url, widthPx: img.srcWidth, heightPx: img.srcHeight };
        // Phase 3: component layer runs first; without a verified component
        // model it honestly reports model_not_available and refinement only
        // labels regions as unmatched — never upgrades them to damage.
        const components = await recognizeComponents(img, componentModel ?? undefined);
        const out = matchAnomaliesToRegions(refineWithComponents(analyzePattern(img), components), components);
        if (out.status === 'no_unusual_regions') noUnusualRegions += 1;
        if (out.status === 'not_assessable') notAssessable += 1;
        result = out.result;
      }
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
    noUnusualRegions,
    notAssessable,
  };
}
