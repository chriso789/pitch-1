/**
 * Pipeline Seeding Script
 * Creates pipeline entries for seeded contacts
 */

import { supabase } from '@/integrations/supabase/client';
import { SEED_TENANT_ID } from './seed-contacts';

const stages = ['new_lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won'];
const statuses = ['active', 'inactive'];

export async function seedPipeline(contactIds: string[]) {
  console.log('🌱 Seeding pipeline entries...');

  const pipelineEntries = contactIds.map((contactId, index) => ({
    tenant_id: SEED_TENANT_ID,
    contact_id: contactId,
    stage: stages[index % stages.length],
    status: statuses[index % 2],
    priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
    estimated_value: Math.floor(Math.random() * 50000) + 10000,
    expected_close_date: new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
  }));

  const { data, error } = await supabase
    .from('pipeline_entries')
    .insert(pipelineEntries)
    .select();

  if (error) {
    console.error('❌ Error seeding pipeline entries:', error);
    throw error;
  }

  console.log(`✅ Successfully seeded ${data.length} pipeline entries`);
  return data;
}

export async function clearPipeline() {
  console.log('🧹 Clearing seeded pipeline entries...');
  
  const { error } = await supabase
    .from('pipeline_entries')
    .delete()
    .eq('tenant_id', SEED_TENANT_ID);

  if (error) {
    console.error('❌ Error clearing pipeline entries:', error);
    throw error;
  }

  console.log('✅ Pipeline entries cleared');
}
