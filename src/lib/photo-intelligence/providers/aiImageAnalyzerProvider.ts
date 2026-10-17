/**
 * RecognitionProvider adapter for the EXISTING `ai-image-analyzer` edge
 * function (gpt-4o-mini via the project's existing OPENAI_API_KEY — no new
 * purchase, no new credentials).
 *
 * Honesty constraints:
 *  - The analyzer returns condition text, insights and priority actions; it
 *    does NOT return damage coordinates. A detection without geometry cannot
 *    become an annotation, so coordinate-less insights are passed through as
 *    `rejected` candidates by validateDetections with an explicit reason —
 *    never converted into invented regions.
 *  - Only structured `detections` entries the model returns WITH bbox or
 *    polygon coordinates become proposals, and those still land as
 *    detection_source 'ai' + review_status 'pending'.
 */

import type { RecognitionPhoto, RecognitionProvider, RecognitionResult, RawDetection } from '../recognition';

export const AI_IMAGE_ANALYZER_PROVIDER_ID = 'ai-image-analyzer';

/** Shape of the edge function's JSON response (supabase/functions/ai-image-analyzer). */
export interface AiImageAnalyzerResponse {
  roof_type?: string;
  condition_rating?: string;
  insights?: string[] | { title?: string; description?: string; severity?: string; confidence?: number; bbox?: number[]; polygon?: number[][] }[];
  detections?: {
    component?: string; condition?: string; description?: string; severity?: string;
    confidence?: number; bbox?: number[]; polygon?: number[][];
  }[];
  measurements?: unknown;
  summary?: string;
  priority_actions?: string[];
  analysis_metadata?: { model_used?: string };
  warnings?: string[];
  error?: string;
}

/**
 * Map the analyzer response into raw detections. Pure — no network.
 * String insights carry no location, so they map to geometry-less candidates
 * (which validation rejects with a reason) unless the model supplied
 * bbox/polygon coordinates.
 */
export function mapAnalyzerResponse(res: AiImageAnalyzerResponse, modelId: string): RecognitionResult {
  const detections: RawDetection[] = [];
  // Structured detections with model-supplied coordinates (preferred path).
  for (const det of Array.isArray(res.detections) ? res.detections : []) {
    const bbox = Array.isArray(det.bbox) && det.bbox.length === 4 ? det.bbox : null;
    const polygon = Array.isArray(det.polygon) && det.polygon.length >= 3 ? det.polygon : null;
    const base = {
      component: det.component ?? res.roof_type ?? 'roof',
      condition: det.description || det.condition || '',
      damageCategory: det.condition ?? undefined,
      confidence: det.confidence,
      noVisibleDamage: det.condition === 'no_visible_damage',
    };
    if (polygon) {
      detections.push({ ...base, kind: 'polygon', polygonNorm: polygon.map((p) => ({ x: Number(p[0]), y: Number(p[1]) })) });
    } else if (bbox) {
      detections.push({ ...base, kind: 'bbox', bboxNorm: { x: Number(bbox[0]), y: Number(bbox[1]), width: Number(bbox[2]), height: Number(bbox[3]) } });
    } else {
      detections.push({ ...base, kind: 'bbox' });
    }
  }
  const insights = Array.isArray(res.insights) ? res.insights : [];
  for (const ins of insights) {
    if (typeof ins === 'string') {
      // Coordinate-less observation: record as a candidate lacking geometry.
      detections.push({ kind: 'bbox', component: res.roof_type ?? 'roof', condition: ins });
      continue;
    }
    const bbox = Array.isArray(ins.bbox) && ins.bbox.length === 4 ? ins.bbox : null;
    const polygon = Array.isArray(ins.polygon) && ins.polygon.length >= 3 ? ins.polygon : null;
    if (polygon) {
      detections.push({
        kind: 'polygon',
        polygonNorm: polygon.map((p) => ({ x: Number(p[0]), y: Number(p[1]) })),
        component: ins.title ?? res.roof_type ?? 'roof',
        condition: ins.description ?? ins.title ?? '',
        confidence: ins.confidence,
      });
    } else if (bbox) {
      detections.push({
        kind: 'bbox',
        bboxNorm: { x: Number(bbox[0]), y: Number(bbox[1]), width: Number(bbox[2]), height: Number(bbox[3]) },
        component: ins.title ?? res.roof_type ?? 'roof',
        condition: ins.description ?? ins.title ?? '',
        confidence: ins.confidence,
      });
    } else {
      detections.push({
        kind: 'bbox',
        component: ins.title ?? res.roof_type ?? 'roof',
        condition: ins.description ?? ins.title ?? '',
      });
    }
  }
  const warnings = [...(res.warnings ?? [])];
  if (detections.length > 0 && detections.every((d) => !d.bboxNorm && !d.polygonNorm)) {
    warnings.push('Model returned no damage coordinates — observations cannot be placed on the photo and will be rejected as unplaceable.');
  }
  if (res.error) warnings.push(`Analyzer error: ${res.error}`);
  return { providerId: AI_IMAGE_ANALYZER_PROVIDER_ID, modelId, detections, warnings };
}

export interface AnalyzerInvoker {
  invoke(body: { image_data: string; analysis_type: string; step_id: string; step_title: string }): Promise<{ data: AiImageAnalyzerResponse | null; error: { message: string } | null }>;
}

/** Live provider. The invoker is injected so tests never touch the network. */
export function createAiImageAnalyzerProvider(invoker: AnalyzerInvoker, modelId = 'gpt-4o-mini'): RecognitionProvider {
  return {
    providerId: AI_IMAGE_ANALYZER_PROVIDER_ID,
    modelId,
    async analyze(photo: RecognitionPhoto): Promise<RecognitionResult> {
      const { data, error } = await invoker.invoke({ image_data: photo.imageRef, analysis_type: 'damage', step_id: photo.photoId, step_title: 'Damage analysis' });
      // A failed request is a failure, never "no damage found".
      if (error) throw new Error(`AI analysis service failed: ${error.message}`);
      if (!data) throw new Error('AI analysis service returned no data');
      return mapAnalyzerResponse(data, data.analysis_metadata?.model_used ?? modelId);
    },
  };
}
