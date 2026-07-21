# QBO Multi-Tenant Isolation Test Suite

Single-command runtime harness for verifying that QuickBooks Online integration
is strictly partitioned per tenant across DB rows, webhooks, and the
authenticated `qbo-worker` edge function.

## Run

```bash
npm run test:qbo-isolation
```

Everything is loaded from environment variables — nothing is hardcoded.
Missing values produce a **BLOCKED** marker (never a false PASS).

## Environment

Always required (for DB isolation + fixture seed):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Per-tenant (both blocks required for cross-tenant live tests):

```
TENANT_A_JWT=...
TENANT_A_TENANT_ID=...
TENANT_A_QBO_CONNECTION_ID=...
TENANT_A_REALM_ID=...
TENANT_A_OAUTH_APP_ENV=development|production

TENANT_B_JWT=...
TENANT_B_TENANT_ID=...
TENANT_B_QBO_CONNECTION_ID=...
TENANT_B_REALM_ID=...
TENANT_B_OAUTH_APP_ENV=development|production
```

Webhook signature tests need at least one of:

```
QBO_WEBHOOK_VERIFIER_DEVELOPMENT=...
QBO_WEBHOOK_VERIFIER_PRODUCTION=...
```

## Human Checklist

```
□ Create Tenant A QBO sandbox company (development env)
□ Create Tenant B QBO sandbox company (development env)
□ Sign in as Tenant A user in Pitch → Settings → QuickBooks → Connect
□ Sign in as Tenant B user in Pitch → Settings → QuickBooks → Connect
□ Copy realm_id + qbo_connections.id for each tenant into env
□ Mint a Supabase user JWT for each tenant (Auth → Users → Impersonate → copy access token)
□ Copy QBO_WEBHOOK_VERIFIER_DEVELOPMENT from the Intuit App dashboard
□ Export SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
□ Run: npm run test:qbo-isolation
□ Review the vitest report — all M3/M4 rows should PASS, M5 rows should PASS
□ Investigate any FAIL (never accept a BLOCKED as PASS)
```

## Phases

| Phase | Scope                                       | Runs without live QBO? |
|-------|---------------------------------------------|------------------------|
| M2    | Idempotent fixture seeder                   | ✅ (tenant IDs only)   |
| M3    | DB-backed isolation (collisions & RLS)      | ✅                     |
| M4    | Webhook signature + realm routing           | ✅ (verifier required) |
| M5    | Live qbo-worker positive + negative matrix  | ❌ requires OAuth      |
