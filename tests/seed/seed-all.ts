/**
 * Master Seeding Script
 * Runs all seeding scripts in correct order
 */

import { seedContacts, clearContacts } from './seed-contacts';
import { seedCampaigns, clearCampaigns } from './seed-campaigns';
import { seedAIAgents, clearAIAgents } from './seed-ai-agents';
import { seedPipeline, clearPipeline } from './seed-pipeline';

export async function seedAll() {
  console.log('🚀 Starting complete database seeding...\n');

  try {
    // Seed in dependency order
    const contacts = await seedContacts();
    const contactIds = contacts.map(c => c.id);
    
    await seedPipeline(contactIds);
    await seedCampaigns();
    await seedAIAgents();

    console.log('\n✅ Complete! Database seeded successfully');
    console.log('📊 Summary:');
    console.log(`   - ${contacts.length} contacts`);
    console.log(`   - ${contactIds.length} pipeline entries`);
    console.log('   - 5 campaigns');
    console.log('   - 5 AI agents');
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    throw error;
  }
}

export async function clearAll() {
  console.log('🧹 Clearing all seeded data...\n');

  try {
    // Clear in reverse dependency order
    await clearPipeline();
    await clearCampaigns();
    await clearAIAgents();
    await clearContacts();

    console.log('\n✅ All seeded data cleared');
  } catch (error) {
    console.error('\n❌ Clearing failed:', error);
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === 'clear') {
    clearAll()
      .then(() => console.log('Done!'))
      .catch(console.error);
  } else {
    seedAll()
      .then(() => console.log('Done!'))
      .catch(console.error);
  }
}
