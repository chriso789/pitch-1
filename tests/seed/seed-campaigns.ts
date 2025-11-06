/**
 * Campaign Seeding Script
 * Populates database with sample dialer campaigns
 */

import { supabase } from '@/integrations/supabase/client';
import { SEED_TENANT_ID } from './seed-contacts';

const sampleCampaigns = [
  {
    name: 'Q1 Outreach Campaign',
    description: 'Primary outreach campaign for Q1 lead generation',
    status: 'active',
    start_date: new Date('2024-01-01').toISOString(),
    end_date: new Date('2024-03-31').toISOString(),
    target_contacts: 500,
    priority: 'high',
  },
  {
    name: 'Product Launch Follow-up',
    description: 'Follow-up calls for recent product launch attendees',
    status: 'active',
    start_date: new Date('2024-02-01').toISOString(),
    end_date: new Date('2024-02-29').toISOString(),
    target_contacts: 200,
    priority: 'high',
  },
  {
    name: 'Customer Retention Check-ins',
    description: 'Regular check-in calls with existing customers',
    status: 'active',
    start_date: new Date('2024-01-15').toISOString(),
    end_date: new Date('2024-12-31').toISOString(),
    target_contacts: 1000,
    priority: 'medium',
  },
  {
    name: 'Cold Lead Reactivation',
    description: 'Reactivation campaign for cold leads from previous quarters',
    status: 'paused',
    start_date: new Date('2024-03-01').toISOString(),
    end_date: new Date('2024-06-30').toISOString(),
    target_contacts: 300,
    priority: 'low',
  },
  {
    name: 'Enterprise Demo Requests',
    description: 'High-priority campaign for enterprise demo requests',
    status: 'active',
    start_date: new Date('2024-01-01').toISOString(),
    target_contacts: 150,
    priority: 'high',
  },
];

export async function seedCampaigns() {
  console.log('🌱 Seeding campaigns...');

  const campaignsWithTenant = sampleCampaigns.map(campaign => ({
    ...campaign,
    tenant_id: SEED_TENANT_ID,
  }));

  const { data, error } = await supabase
    .from('dialer_campaigns' as any)
    .insert(campaignsWithTenant)
    .select();

  if (error) {
    console.error('❌ Error seeding campaigns:', error);
    throw error;
  }

  console.log(`✅ Successfully seeded ${data.length} campaigns`);
  return data;
}

export async function clearCampaigns() {
  console.log('🧹 Clearing seeded campaigns...');
  
  const { error } = await supabase
    .from('dialer_campaigns' as any)
    .delete()
    .eq('tenant_id', SEED_TENANT_ID);

  if (error) {
    console.error('❌ Error clearing campaigns:', error);
    throw error;
  }

  console.log('✅ Campaigns cleared');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedCampaigns()
    .then(() => console.log('Done!'))
    .catch(console.error);
}
