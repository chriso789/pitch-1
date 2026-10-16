import { supabase } from '@/integrations/supabase/client';

/**
 * Removes leftover auto-saved drafts for a lead/job once a real estimate has
 * been saved, so the project only shows a draft when work was left unsaved.
 */
export async function deleteAutoDraftsForPipeline(
  pipelineEntryId: string,
  keepId?: string | null
): Promise<void> {
  if (!pipelineEntryId) return;
  try {
    const { data } = await supabase
      .from('enhanced_estimates')
      .select('id, property_details')
      .eq('pipeline_entry_id', pipelineEntryId)
      .eq('status', 'draft');
    const ids = (data || [])
      .filter((r: any) => r?.property_details?.is_auto_draft === true && r.id !== keepId)
      .map((r: any) => r.id);
    if (ids.length) {
      await supabase.from('enhanced_estimates').delete().in('id', ids);
    }
  } catch (e) {
    console.warn('Auto-draft cleanup failed:', e);
  }
}

/** True when an auto-draft is older than the newest saved (non-draft-copy) estimate. */
export function isStaleAutoDraft(
  draftUpdatedAt: string | null | undefined,
  savedTimestamps: Array<string | null | undefined>
): boolean {
  const d = new Date(draftUpdatedAt || 0).getTime();
  return savedTimestamps.some((t) => new Date(t || 0).getTime() >= d);
}
