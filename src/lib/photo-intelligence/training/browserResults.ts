import { edgeApi } from '@/lib/edgeApi';

export interface BrowserPreparationResult {
  photo: number;
  photoId: string;
  status: 'completed' | 'no_useful_regions' | 'failed' | 'unassessable' | 'duplicate' | 'access_unavailable';
  width: number | null;
  height: number | null;
  outlines: { polygon: { x: number; y: number }[]; group: number }[];
  invalidRegions: number;
  durationMs: number;
  error: string | null;
  segmenter: string | null;
  embedder: string | null;
  saveStatus: 'verified' | 'failed' | 'not_saved';
  existingOutlinesPreserved?: boolean;
}
export interface BrowserTest {
  testId: string | null;
  selection: { id: string; tenantId: string; propertyKey: string; photo: number }[];
  results: BrowserPreparationResult[];
  photos: { id: string; photo: number; url: string | null }[];
}
export async function loadBrowserTest(testId?: string): Promise<BrowserTest> {
  const response = await edgeApi<BrowserTest>('training-data-api', '/photos/browser/read', testId ? { testId } : {});
  if (response.error || !response.data) throw new Error(response.error ?? 'Saved test unavailable');
  return response.data;
}