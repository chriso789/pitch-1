import { edgeApi } from '@/lib/edgeApi';

export interface PreparationItem { id: string; status: string; attempts: number; region_count: number; duration_ms: number | null; error: string | null }
export interface PreparationJob { id: string; status: string; item_limit: number; blocked_reason: string | null; created_at: string; photo_preparation_items: PreparationItem[] }
export async function loadPreparationJobs() {
  const r = await edgeApi<{ jobs: PreparationJob[]; workerConfigured: boolean; workerRequirement: string }>('training-data-api', '/photos/jobs/list');
  if (r.error || !r.data) throw new Error(r.error ?? 'Preparation progress unavailable');
  return r.data;
}
export async function preparationAction(action: 'create' | 'manage' | 'publish', payload: Record<string, unknown> = {}) {
  const route = action === 'publish' ? '/references/publish' : `/photos/jobs/${action}`;
  const r = await edgeApi('training-data-api', route, payload);
  if (r.error) throw new Error(r.error);
  return r.data;
}