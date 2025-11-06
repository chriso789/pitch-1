/**
 * Rate Limiting Test Helpers
 * Helper functions for testing rate limiting and throttling
 */

import { supabase } from '@/integrations/supabase/client';
import { TEST_TENANT_ID } from './db-helpers';

/**
 * Clear rate limit logs for testing
 */
export async function clearRateLimitLogs(userId: string) {
  await supabase
    .from('api_rate_limits')
    .delete()
    .eq('user_id', userId);
}

/**
 * Simulate rate limit hits
 */
export async function simulateRateLimitHits(
  userId: string,
  count: number,
  endpoint: string = 'power-dialer-controller'
) {
  const records = Array.from({ length: count }, () => ({
    tenant_id: TEST_TENANT_ID,
    user_id: userId,
    endpoint,
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('api_rate_limits')
    .insert(records);

  if (error) throw error;
}

/**
 * Get rate limit count for user
 */
export async function getRateLimitCount(
  userId: string,
  timeWindowMinutes: number = 60
) {
  const timeAgo = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

  const { count, error } = await supabase
    .from('api_rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', timeAgo.toISOString());

  if (error) throw error;
  return count || 0;
}

/**
 * Clear all call logs for testing
 */
export async function clearCallLogs(sessionId?: string) {
  let query = supabase.from('call_logs' as any).delete();
  
  if (sessionId) {
    query = query.eq('session_id', sessionId);
  } else {
    query = query.eq('tenant_id', TEST_TENANT_ID);
  }

  const { error } = await query;
  if (error) throw error;
}

/**
 * Get call count for session within time window
 */
export async function getCallCount(sessionId: string, timeWindowHours: number = 1) {
  const timeAgo = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  const { count, error } = await supabase
    .from('call_logs' as any)
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('created_at', timeAgo.toISOString());

  if (error) throw error;
  return count || 0;
}

/**
 * Simulate call history for throttling tests
 */
export async function simulateCallHistory(
  sessionId: string,
  tenantId: string,
  contactId: string,
  count: number,
  hoursAgo: number = 0
) {
  const baseTime = Date.now() - hoursAgo * 60 * 60 * 1000;
  
  const records = Array.from({ length: count }, (_, i) => ({
    tenant_id: tenantId,
    session_id: sessionId,
    contact_id: contactId,
    phone_number: '+1-555-0100',
    status: 'completed',
    disposition: 'answered',
    created_at: new Date(baseTime - i * 60000).toISOString(), // 1 minute apart
  }));

  const { error } = await supabase
    .from('call_logs' as any)
    .insert(records);

  if (error) throw error;
}
