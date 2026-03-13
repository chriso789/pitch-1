import { supabase } from '@/integrations/supabase/client';

export type MobileActivityType =
  | 'mobile_login_restored'
  | 'offline_note_created'
  | 'pending_sync_processed'
  | 'photo_uploaded'
  | 'alert_opened'
  | 'field_mode_opened'
  | 'deep_link_navigated';

interface ActivityEntry {
  activity_type: MobileActivityType;
  entity_type?: string;
  entity_id?: string;
  metadata_json?: Record<string, any>;
}

let buffer: ActivityEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function logMobileActivity(entry: ActivityEntry): void {
  buffer.push(entry);
  if (!flushTimer) {
    flushTimer = setInterval(flushBuffer, 30_000);
  }
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0 || !navigator.onLine) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, active_tenant_id')
    .eq('id', user.id)
    .single();

  const companyId = profile?.active_tenant_id || profile?.tenant_id;
  if (!companyId) return;

  const rows = buffer.map(e => ({
    user_id: user.id,
    company_id: companyId,
    activity_type: e.activity_type,
    entity_type: e.entity_type || null,
    entity_id: e.entity_id || null,
    metadata_json: e.metadata_json || {},
  }));

  buffer = [];

  await supabase.from('mobile_activity_logs').insert(rows).then(({ error }) => {
    if (error) console.error('Mobile activity log flush failed:', error);
  });
}

export function startActivityLogger(): () => void {
  if (!flushTimer) {
    flushTimer = setInterval(flushBuffer, 30_000);
  }
  return () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flushBuffer(); // Flush remaining
  };
}
