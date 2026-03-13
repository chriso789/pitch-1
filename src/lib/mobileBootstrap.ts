import { supabase } from '@/integrations/supabase/client';
import { processQueue } from './mobileSyncManager';
import { cacheRecord } from './mobileCache';

export async function bootstrapMobileSession(): Promise<{
  valid: boolean;
  userId?: string;
  alertCount?: number;
}> {
  try {
    // 1. Validate JWT via mobile-session edge function
    const { data: sessionData, error: sessionError } = await supabase.functions.invoke(
      'mobile-session',
      { method: 'GET' }
    );

    if (sessionError || !sessionData?.authenticated) {
      return { valid: false };
    }

    const userId = sessionData.userId;

    // 2. Process pending sync queue
    await processQueue().catch(console.error);

    // 3. Fetch unread alert count
    const { count: alertCount } = await supabase
      .from('job_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);

    // 4. Pre-cache next 10 assigned jobs
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('assigned_to', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (jobs) {
      await Promise.all(jobs.map(job => cacheRecord('jobs', job.id, job)));
    }

    return { valid: true, userId, alertCount: alertCount ?? 0 };
  } catch (err) {
    console.error('Mobile bootstrap failed:', err);
    return { valid: false };
  }
}

export function setupVisibilityListener(onResume: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') {
      onResume();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
