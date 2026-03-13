import { getPendingSyncQueue, clearPendingSyncItem, type PendingSyncItem } from './mobileCache';
import { supabase } from '@/integrations/supabase/client';

export interface SyncResult {
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

type SyncHandler = (item: PendingSyncItem) => Promise<void>;

const syncHandlers: Record<string, SyncHandler> = {
  create_note: async (item) => {
    const { error } = await supabase.from('user_activity_log').insert({
      tenant_id: item.payload.tenant_id,
      user_id: item.payload.user_id,
      action_type: 'note_created',
      action_category: item.payload.note_type || 'note',
      description: item.payload.body,
      created_at: item.payload.created_at,
    });
    if (error) throw new Error(error.message);
  },

  update_job_status: async (item) => {
    // Conflict check: compare updated_at
    if (item.updatedAt) {
      const { data: current } = await supabase
        .from('jobs')
        .select('updated_at')
        .eq('id', item.entityId)
        .single();
      if (current && current.updated_at > item.updatedAt) {
        throw new Error('CONFLICT_SKIPPED');
      }
    }
    const { error } = await supabase
      .from('jobs')
      .update(item.payload)
      .eq('id', item.entityId);
    if (error) throw new Error(error.message);
  },

  create_task: async (item) => {
    const { error } = await supabase.from('tasks').insert(item.payload);
    if (error) throw new Error(error.message);
  },

  upload_document_metadata: async (item) => {
    const { error } = await supabase.from('job_media').insert(item.payload);
    if (error) throw new Error(error.message);
  },

  add_contact_log: async (item) => {
    const { error } = await supabase.from('activities').insert(item.payload);
    if (error) throw new Error(error.message);
  },

  save_measurement_note: async (item) => {
    const { error } = await supabase.from('activities').insert({
      ...item.payload,
      type: 'measurement_note',
    });
    if (error) throw new Error(error.message);
  },
};

export async function processQueue(): Promise<SyncResult> {
  const queue = await getPendingSyncQueue();
  const result: SyncResult = { success: 0, failed: 0, skipped: 0, errors: [] };

  for (const item of queue) {
    const handler = syncHandlers[item.action];
    if (!handler) {
      result.skipped++;
      await clearPendingSyncItem(item.id);
      continue;
    }

    try {
      await handler(item);
      await clearPendingSyncItem(item.id);
      result.success++;
    } catch (err: any) {
      if (err.message === 'CONFLICT_SKIPPED') {
        await clearPendingSyncItem(item.id);
        result.skipped++;
      } else {
        result.failed++;
        result.errors.push({ id: item.id, error: err.message });
      }
    }
  }

  return result;
}

let listening = false;

export function startNetworkMonitor(onSync?: (result: SyncResult) => void): () => void {
  if (listening) return () => {};
  listening = true;

  const handler = async () => {
    if (navigator.onLine) {
      const result = await processQueue();
      onSync?.(result);
    }
  };

  window.addEventListener('online', handler);
  return () => {
    window.removeEventListener('online', handler);
    listening = false;
  };
}
