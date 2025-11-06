/**
 * AI Agent Seeding Script
 * Populates database with sample AI agents with different configurations
 */

import { supabase } from '@/integrations/supabase/client';
import { SEED_TENANT_ID } from './seed-contacts';

const sampleAgents = [
  {
    name: 'Power Dialer Pro',
    type: 'power_dialer',
    status: 'active',
    description: 'High-volume power dialer for lead generation',
    configuration: {
      mode: 'power',
      maxCallsPerHour: 100,
      callTimeout: 30,
      autoDialDelay: 2,
      recordCalls: true,
      voicemailDetection: true,
    },
  },
  {
    name: 'Smart Predictive Dialer',
    type: 'power_dialer',
    status: 'active',
    description: 'AI-powered predictive dialer with smart routing',
    configuration: {
      mode: 'predictive',
      maxCallsPerHour: 150,
      callTimeout: 25,
      autoDialDelay: 1,
      recordCalls: true,
      voicemailDetection: true,
      predictiveAlgorithm: 'ml_based',
    },
  },
  {
    name: 'Preview Dialer - Sales Team',
    type: 'power_dialer',
    status: 'active',
    description: 'Preview dialer for high-value sales conversations',
    configuration: {
      mode: 'preview',
      maxCallsPerHour: 40,
      callTimeout: 60,
      previewTime: 30,
      recordCalls: true,
      voicemailDetection: false,
    },
  },
  {
    name: 'Follow-up Automation Agent',
    type: 'power_dialer',
    status: 'active',
    description: 'Automated follow-up agent for post-meeting calls',
    configuration: {
      mode: 'power',
      maxCallsPerHour: 80,
      callTimeout: 20,
      autoDialDelay: 3,
      recordCalls: true,
      voicemailDetection: true,
      autoFollowUp: true,
    },
  },
  {
    name: 'Test Agent - Development',
    type: 'power_dialer',
    status: 'inactive',
    description: 'Test agent for development purposes',
    configuration: {
      mode: 'power',
      maxCallsPerHour: 10,
      callTimeout: 15,
      autoDialDelay: 5,
      recordCalls: false,
      voicemailDetection: false,
    },
  },
];

export async function seedAIAgents() {
  console.log('🌱 Seeding AI agents...');

  const agentsWithTenant = sampleAgents.map(agent => ({
    ...agent,
    tenant_id: SEED_TENANT_ID,
  }));

  const { data, error } = await supabase
    .from('ai_agents' as any)
    .insert(agentsWithTenant)
    .select();

  if (error) {
    console.error('❌ Error seeding AI agents:', error);
    throw error;
  }

  console.log(`✅ Successfully seeded ${data.length} AI agents`);
  return data;
}

export async function clearAIAgents() {
  console.log('🧹 Clearing seeded AI agents...');
  
  const { error } = await supabase
    .from('ai_agents' as any)
    .delete()
    .eq('tenant_id', SEED_TENANT_ID);

  if (error) {
    console.error('❌ Error clearing AI agents:', error);
    throw error;
  }

  console.log('✅ AI agents cleared');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAIAgents()
    .then(() => console.log('Done!'))
    .catch(console.error);
}
