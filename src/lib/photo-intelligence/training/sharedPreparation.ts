import { assessQuality, loadImageForAnalysis } from '../patternAnalysis';
import { differenceHash, markDuplicates, recommendForLabeling, type TriagedPhoto } from '../components/photoTriage';
import { proposeRegions } from '../components/regionProposals';
import { isValidPolygon } from '../components/photoProcessing';
import { edgeApi } from '@/lib/edgeApi';
import { loadSharedInventory } from './sharedInventory';

export interface BrowserPreparationResult {
  photo: number;
  status: 'completed' | 'no_useful_regions' | 'failed' | 'unassessable' | 'duplicate' | 'access_unavailable';
  regions: number;
  durationMs: number;
  error: string | null;
}

/** User-started foreground acceptance test; separate from durable cloud jobs. */
export async function prepareSharedPhotos(onProgress: (message: string) => void): Promise<BrowserPreparationResult[]> {
  const inventory = await loadSharedInventory(true);
  const triaged: TriagedPhoto[] = [];
  const photos = inventory.photos.slice(0, 10);
  const results: BrowserPreparationResult[] = [];
  for (const [index, original] of photos.entries()) {
    onProgress(`Checking ${triaged.length + 1}/${photos.length}`);
    const start = performance.now();
    // Refresh current consent and signed access for every original, not just outlines.
    const current = await loadSharedInventory(true);
    const photo = current.photos.find((p) => p.id === original.id);
    if (!photo?.url) {
      results.push({ photo: index + 1, status: 'access_unavailable', regions: 0, durationMs: Math.round(performance.now() - start), error: photo?.accessError ?? 'Current photo access or contribution consent unavailable' });
      continue;
    }
    let quality = { assessable: false, sharpness: 0, brightness: 0, issues: [photo.accessError ?? 'Photo could not be opened'] };
    let hash: string | null = null;
    try {
      if (photo.url) {
        const image = await loadImageForAnalysis(photo.url, 256);
        quality = assessQuality(image); hash = differenceHash(image);
      }
    } catch { /* keep concrete access failure */ }
    const { error } = await edgeApi('training-data-api', '/photos/save', {
      photoId: photo.id, quality: { ...quality, dhash: hash, processing_ms: Math.round(performance.now() - start) },
    });
    if (error) throw new Error(error);
    triaged.push({ id: photo.id, propertyKey: `${photo.tenantId}:${photo.propertyKey}`, hash, sharpness: quality.sharpness, assessable: quality.assessable, issues: quality.issues, duplicateOf: null });
    if (!quality.assessable) results.push({ photo: index + 1, status: 'unassessable', regions: 0, durationMs: Math.round(performance.now() - start), error: quality.issues.join('; ') });
  }
  const deduplicated = markDuplicates(triaged);
  for (const photo of deduplicated.filter((p) => p.assessable && p.duplicateOf)) {
    results.push({ photo: photos.findIndex((p) => p.id === photo.id) + 1, status: 'duplicate', regions: 0, durationMs: 0, error: null });
  }
  const recommended = recommendForLabeling(deduplicated, 10);
  for (let i = 0; i < recommended.length; i++) {
    onProgress(`Outlining ${i + 1}/${recommended.length}`);
    // Refresh consent and five-minute original access before every photo.
    const current = await loadSharedInventory(true);
    const photo = current.photos.find((p) => p.id === recommended[i].id);
    const number = photos.findIndex((p) => p.id === recommended[i].id) + 1;
    if (!photo?.url) {
      results.push({ photo: number, status: 'access_unavailable', regions: 0, durationMs: 0, error: photo?.accessError ?? 'Current photo access or contribution consent unavailable' });
      continue;
    }
    const start = performance.now();
    let payload: Record<string, unknown>;
    let result: BrowserPreparationResult;
    try {
      const report = await proposeRegions(photo.url, { version: 0, embeddingModelId: 'dinov2-small', examples: [] });
      if (!report.models.segmenter?.startsWith('sam') || !report.models.embedder) throw new Error(report.warnings.join(' ') || 'Local models unavailable');
      const valid = report.regions.filter((r) => isValidPolygon(r.polygon));
      payload = { report: { ...report, regions: valid.map((r) => ({ id: r.id, polygon: r.polygon, group: r.group, suggestion: r.suggestion })) }, status: valid.length ? 'completed' : 'no_useful_regions', invalid: report.regions.length - valid.length };
      result = { photo: number, status: valid.length ? 'completed' : 'no_useful_regions', regions: valid.length, durationMs: Math.round(performance.now() - start), error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Processing failed';
      payload = { status: 'failed', error };
      result = { photo: number, status: 'failed', regions: 0, durationMs: Math.round(performance.now() - start), error };
    }
    const saved = await edgeApi('training-data-api', '/photos/save', { photoId: photo.id, ...payload, duration: result.durationMs });
    if (saved.error) throw new Error(saved.error);
    results.push(result);
  }
  return results.sort((a, b) => a.photo - b.photo);
}