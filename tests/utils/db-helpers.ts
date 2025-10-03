/**
 * Database Test Helpers
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

import { supabase } from '@/integrations/supabase/client';

export const TEST_TENANT_ID = 'test-tenant-00000000-0000-0000-0000-000000000001';

/**
 * Create test contact
 */
export async function createTestContact(overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      tenant_id: TEST_TENANT_ID,
      first_name: 'Test',
      last_name: 'Contact',
      email: 'test@contact.test',
      phone: '555-0100',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create test pipeline entry
 */
export async function createTestPipelineEntry(contactId: string, overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('pipeline_entries')
    .insert({
      tenant_id: TEST_TENANT_ID,
      contact_id: contactId,
      stage: 'new_lead',
      status: 'active',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create test project
 */
export async function createTestProject(overrides: Partial<any> = {}) {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      tenant_id: TEST_TENANT_ID,
      name: 'Test Project',
      status: 'active',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Clean up test data
 */
export async function cleanupTestData() {
  // Delete in reverse order of dependencies
  await supabase.from('pipeline_entries').delete().eq('tenant_id', TEST_TENANT_ID);
  await supabase.from('contacts').delete().eq('tenant_id', TEST_TENANT_ID);
  await supabase.from('projects').delete().eq('tenant_id', TEST_TENANT_ID);
}
