# Test Data Seeding Scripts

This directory contains scripts to populate the database with sample data for development and testing purposes.

## Scripts

- **`seed-contacts.ts`** - Seeds 15 sample contacts with realistic data
- **`seed-campaigns.ts`** - Seeds 5 dialer campaigns with various statuses
- **`seed-ai-agents.ts`** - Seeds 5 AI agents with different configurations
- **`seed-pipeline.ts`** - Seeds pipeline entries for contacts
- **`seed-all.ts`** - Master script that runs all seeders in correct order

## Usage

### Seed All Data

```bash
# Using bun
bun tests/seed/seed-all.ts

# Using tsx
npx tsx tests/seed/seed-all.ts
```

### Seed Individual Resources

```bash
# Contacts only
bun tests/seed/seed-contacts.ts

# Campaigns only
bun tests/seed/seed-campaigns.ts

# AI Agents only
bun tests/seed/seed-ai-agents.ts
```

### Clear All Seeded Data

```bash
bun tests/seed/seed-all.ts clear
```

## Integration with Tests

Import and use in your test files:

```typescript
import { seedAll, clearAll } from '../seed/seed-all';
import { SEED_TENANT_ID } from '../seed/seed-contacts';

describe('Power Dialer Tests', () => {
  beforeAll(async () => {
    await seedAll();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('should work with seeded data', async () => {
    // Your test using SEED_TENANT_ID
  });
});
```

## What Gets Seeded

### Contacts (15)
- Realistic names, emails, and phone numbers
- Associated with various companies
- Ready for power dialer operations

### Campaigns (5)
- Q1 Outreach Campaign (Active, High Priority)
- Product Launch Follow-up (Active, High Priority)
- Customer Retention Check-ins (Active, Medium Priority)
- Cold Lead Reactivation (Paused, Low Priority)
- Enterprise Demo Requests (Active, High Priority)

### AI Agents (5)
- Power Dialer Pro (100 calls/hour)
- Smart Predictive Dialer (150 calls/hour)
- Preview Dialer - Sales Team (40 calls/hour)
- Follow-up Automation Agent (80 calls/hour)
- Test Agent - Development (Inactive, 10 calls/hour)

### Pipeline Entries
- One entry per contact
- Distributed across different stages
- Includes estimated values and close dates

## Tenant ID

All seeded data uses a consistent tenant ID:
```
seed-tenant-00000000-0000-0000-0000-000000000001
```

This makes it easy to identify and clean up seeded data.

## Best Practices

1. **Always clear data after tests** - Use `afterEach` or `afterAll` hooks
2. **Use SEED_TENANT_ID** - Import from seed-contacts.ts for consistency
3. **Seed in order** - Use seed-all.ts to ensure dependencies are handled
4. **Clear in reverse order** - Pipeline → Campaigns → Agents → Contacts

## Environment

Seeding scripts use the same Supabase client as your application, so they work with your configured environment (development, staging, production).

⚠️ **Warning**: Never run seeding scripts in production!
