import { assessQuality, loadImageForAnalysis } from '../patternAnalysis';
import { differenceHash, markDuplicates, recommendForLabeling, type TriagedPhoto } from '../components/photoTriage';
import { proposeRegions } from '../components/regionProposals';
import { isValidPolygon } from '../components/photoProcessing';
import { edgeApi } from '@/lib/edgeApi';
import { loadSharedInventory } from './sharedInventory';

export async function prepareSharedPhotos(onProgress: (message: string) => void) {
  const inventory = await loadSharedInventory(true);
  const triaged: TriagedPhoto[] = [];
  const photos = inventory.photos;
  for (const photo of photos) {
    onProgress(`Checking ${triaged.length + 1}/${photos.length}`);
    const start = performance.now();
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
  }
  const recommended = recommendForLabeling(markDuplicates(triaged), 100);
  for (let i = 0; i < recommended.length; i++) {
    onProgress(`Outlining ${i + 1}/${recommended.length}`);
    // Refresh consent and five-minute original access before every photo.
    const current = await loadSharedInventory(true);
    const photo = current.photos.find((p) => p.id === recommended[i].id);
    if (!photo?.url) continue;
    const start = performance.now();
    let payload: Record<string, unknown>;
    try {
      const report = await proposeRegions(photo.url, { version: 0, embeddingModelId: 'dinov2-small', examples: [] });
      if (!report.models.segmenter?.startsWith('sam') || !report.models.embedder) throw new Error(report.warnings.join(' ') || 'Local models unavailable');
      const valid = report.regions.filter((r) => isValidPolygon(r.polygon));
      payload = { report: { ...report, regions: valid.map((r) => ({ id: r.id, polygon: r.polygon, group: r.group, suggestion: r.suggestion })) }, status: valid.length ? 'completed' : 'no_useful_regions', invalid: report.regions.length - valid.length };
    } catch (e) { payload = { status: 'failed', error: e instanceof Error ? e.message : 'Processing failed' }; }
    const saved = await edgeApi('training-data-api', '/photos/save', { photoId: photo.id, ...payload, duration: Math.round(performance.now() - start) });
    if (saved.error) throw new Error(saved.error);
  }
}