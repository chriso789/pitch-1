import { assessQuality, loadImageForAnalysis } from '../patternAnalysis';
import { differenceHash, markDuplicates, type TriagedPhoto } from '../components/photoTriage';
import { proposeRegions } from '../components/regionProposals';
import { isValidPolygon } from '../components/photoProcessing';
import { edgeApi } from '@/lib/edgeApi';
import { loadBrowserTest, type BrowserPreparationResult, type BrowserTest } from './browserResults';
export type { BrowserPreparationResult } from './browserResults';

/** User-started foreground acceptance test; separate from durable cloud jobs. */
export async function prepareSharedPhotos(onProgress: (message: string) => void, onResult?: (r: BrowserPreparationResult) => void): Promise<BrowserPreparationResult[]> {
  const started = await edgeApi<Pick<BrowserTest, 'testId' | 'selection'>>('training-data-api', '/photos/browser/start', {});
  if (started.error || !started.data?.testId) throw new Error(started.error ?? 'Test selection could not be saved');
  const testId = started.data.testId;
  const photos = started.data.selection.slice(0, 10);
  const triaged: TriagedPhoto[] = [];
  const results: BrowserPreparationResult[] = [];
  for (const original of photos) {
    onProgress(`Processing ${original.photo}/${photos.length}`);
    const start = performance.now();
    let result: BrowserPreparationResult = { photo: original.photo, photoId: original.id, status: 'failed', width: null, height: null, outlines: [], invalidRegions: 0, durationMs: 0, error: null, segmenter: null, embedder: null, saveStatus: 'not_saved' };
    try {
      const current = await loadBrowserTest(testId);
      const photo = current.photos.find((p) => p.id === original.id);
      if (!photo?.url) {
        result.status = 'access_unavailable'; result.error = 'Current photo access or contribution consent unavailable';
      } else {
        const image = await loadImageForAnalysis(photo.url, 256);
        result.width = image.width; result.height = image.height;
        const quality = assessQuality(image);
        const hash = differenceHash(image);
        triaged.push({ id: original.id, propertyKey: `${original.tenantId}:${original.propertyKey}`, hash, sharpness: quality.sharpness, assessable: quality.assessable, issues: quality.issues, duplicateOf: null });
        const duplicate = markDuplicates(triaged).find((p) => p.id === original.id)?.duplicateOf;
        if (!quality.assessable) { result.status = 'unassessable'; result.error = quality.issues.join('; '); }
        else if (duplicate) { result.status = 'duplicate'; }
        else {
          const refreshed = await loadBrowserTest(testId);
          const url = refreshed.photos.find((p) => p.id === original.id)?.url;
          if (!url) { result.status = 'access_unavailable'; result.error = 'Current photo access or contribution consent unavailable'; }
          else {
            const report = await proposeRegions(url, { version: 0, embeddingModelId: 'dinov2-small', examples: [] });
            if (!report.models.segmenter?.startsWith('sam') || !report.models.embedder) throw new Error('DINOv2 or SAM did not complete');
            result.segmenter = report.models.segmenter; result.embedder = report.models.embedder;
            result.width = report.imageSize?.width ?? result.width; result.height = report.imageSize?.height ?? result.height;
            const valid = report.regions.filter((r) => isValidPolygon(r.polygon));
            result.outlines = valid.map((r) => ({ polygon: r.polygon, group: r.group }));
            result.invalidRegions = report.regions.length - valid.length;
            result.status = valid.length ? 'completed' : 'no_useful_regions';
          }
        }
      }
    } catch { result.status = 'failed'; result.error = 'Photo decode or DINOv2/SAM execution failed'; }
    result.durationMs = Math.round(performance.now() - start);
    try {
      const saved = await edgeApi<{ result: BrowserPreparationResult }>('training-data-api', '/photos/browser/save', { testId, photoId: original.id, result });
      if (saved.error || !saved.data?.result) throw new Error(saved.error ?? 'Save/read-back failed');
      result = saved.data.result;
    } catch { result.saveStatus = 'failed'; result.error = [result.error, 'Save/read-back failed; result is not confirmed persisted'].filter(Boolean).join('; '); }
    results.push(result); onResult?.(result);
  }
  return results;
}