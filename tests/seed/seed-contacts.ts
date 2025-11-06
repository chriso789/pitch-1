/**
 * Contact Seeding Script
 * Populates database with sample contacts for development/testing
 */

import { supabase } from '@/integrations/supabase/client';

export const SEED_TENANT_ID = 'seed-tenant-00000000-0000-0000-0000-000000000001';

const sampleContacts = [
  {
    first_name: 'John',
    last_name: 'Smith',
    email: 'john.smith@example.com',
    phone: '+1-555-0101',
    company: 'Tech Corp',
  },
  {
    first_name: 'Sarah',
    last_name: 'Johnson',
    email: 'sarah.j@example.com',
    phone: '+1-555-0102',
    company: 'Innovation Labs',
  },
  {
    first_name: 'Michael',
    last_name: 'Williams',
    email: 'michael.w@example.com',
    phone: '+1-555-0103',
    company: 'Global Solutions',
  },
  {
    first_name: 'Emily',
    last_name: 'Brown',
    email: 'emily.brown@example.com',
    phone: '+1-555-0104',
    company: 'Digital Ventures',
  },
  {
    first_name: 'David',
    last_name: 'Martinez',
    email: 'david.m@example.com',
    phone: '+1-555-0105',
    company: 'Enterprise Systems',
  },
  {
    first_name: 'Jessica',
    last_name: 'Garcia',
    email: 'jessica.garcia@example.com',
    phone: '+1-555-0106',
    company: 'Cloud Networks',
  },
  {
    first_name: 'James',
    last_name: 'Rodriguez',
    email: 'james.r@example.com',
    phone: '+1-555-0107',
    company: 'Data Insights',
  },
  {
    first_name: 'Ashley',
    last_name: 'Wilson',
    email: 'ashley.wilson@example.com',
    phone: '+1-555-0108',
    company: 'Smart Analytics',
  },
  {
    first_name: 'Christopher',
    last_name: 'Anderson',
    email: 'chris.anderson@example.com',
    phone: '+1-555-0109',
    company: 'Future Tech',
  },
  {
    first_name: 'Jennifer',
    last_name: 'Taylor',
    email: 'jennifer.t@example.com',
    phone: '+1-555-0110',
    company: 'Growth Partners',
  },
  {
    first_name: 'Matthew',
    last_name: 'Thomas',
    email: 'matt.thomas@example.com',
    phone: '+1-555-0111',
    company: 'Success Strategies',
  },
  {
    first_name: 'Amanda',
    last_name: 'Moore',
    email: 'amanda.moore@example.com',
    phone: '+1-555-0112',
    company: 'Peak Performance',
  },
  {
    first_name: 'Daniel',
    last_name: 'Jackson',
    email: 'daniel.j@example.com',
    phone: '+1-555-0113',
    company: 'Market Leaders',
  },
  {
    first_name: 'Melissa',
    last_name: 'White',
    email: 'melissa.white@example.com',
    phone: '+1-555-0114',
    company: 'Prime Solutions',
  },
  {
    first_name: 'Robert',
    last_name: 'Harris',
    email: 'robert.harris@example.com',
    phone: '+1-555-0115',
    company: 'Elite Services',
  },
];

export async function seedContacts() {
  console.log('🌱 Seeding contacts...');

  const contactsWithTenant = sampleContacts.map(contact => ({
    ...contact,
    tenant_id: SEED_TENANT_ID,
  }));

  const { data, error } = await supabase
    .from('contacts')
    .insert(contactsWithTenant)
    .select();

  if (error) {
    console.error('❌ Error seeding contacts:', error);
    throw error;
  }

  console.log(`✅ Successfully seeded ${data.length} contacts`);
  return data;
}

export async function clearContacts() {
  console.log('🧹 Clearing seeded contacts...');
  
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('tenant_id', SEED_TENANT_ID);

  if (error) {
    console.error('❌ Error clearing contacts:', error);
    throw error;
  }

  console.log('✅ Contacts cleared');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedContacts()
    .then(() => console.log('Done!'))
    .catch(console.error);
}
