/**
 * Power Dialer Test Helpers
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { supabase } from '@/integrations/supabase/client';

export const TEST_TENANT_ID = 'test-tenant-00000000-0000-0000-0000-000000000001';

/**
 * Create test AI agent
 */
export async function createTestAgent(overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('ai_agents' as any)
    .insert({
      tenant_id: TEST_TENANT_ID,
      name: 'Test Power Dialer',
      type: 'power_dialer',
      status: 'active',
      configuration: {
        mode: 'power',
        maxCallsPerHour: 100,
        callTimeout: 30
      },
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create test dialer session
 */
export async function createTestDialerSession(agentId: string, overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('power_dialer_sessions' as any)
    .insert({
      tenant_id: TEST_TENANT_ID,
      agent_id: agentId,
      mode: 'power',
      status: 'active',
      contacts_attempted: 0,
      contacts_reached: 0,
      contacts_converted: 0,
      started_at: new Date().toISOString(),
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create test dialer campaign
 */
export async function createTestCampaign(overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('dialer_campaigns' as any)
    .insert({
      tenant_id: TEST_TENANT_ID,
      name: 'Test Campaign',
      status: 'active',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create test call log
 */
export async function createTestCallLog(sessionId: string, contactId: string, overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('call_logs' as any)
    .insert({
      tenant_id: TEST_TENANT_ID,
      session_id: sessionId,
      contact_id: contactId,
      phone_number: '555-0100',
      status: 'completed',
      disposition: 'answered',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Clean up power dialer test data
 */
export async function cleanupPowerDialerData() {
  // Delete in reverse order of dependencies
  await supabase.from('call_logs' as any).delete().eq('tenant_id', TEST_TENANT_ID);
  await supabase.from('power_dialer_sessions' as any).delete().eq('tenant_id', TEST_TENANT_ID);
  await supabase.from('dialer_campaigns' as any).delete().eq('tenant_id', TEST_TENANT_ID);
  await supabase.from('ai_agents' as any).delete().eq('tenant_id', TEST_TENANT_ID);
}

/**
 * Get session metrics
 */
export async function getSessionMetrics(sessionId: string) {
  const { data, error } = await supabase
    .from('power_dialer_sessions' as any)
    .select('contacts_attempted, contacts_reached, contacts_converted')
    .eq('id', sessionId)
    .single();

  if (error) throw error;
  return data;
}
