---
name: pitch-crm-route-migration-enforcer
description: Aggressively reduces Pitch CRM Supabase Edge Function bloat — migrates legacy `supabase.functions.invoke("old-name")` calls into grouped `*-api`/`*-worker`/`*-webhook` routes via `edgeApi(...)`, shims old function folders, wires scaffold-only grouped functions, and reports exact audit counts. Trigger on any Pitch CRM backend, edge function, frontend invoke call, consolidation, migration, or cleanup work.
---

# Pitch CRM Route Migration Enforcer

**Primary objective:** Reduce Supabase Edge Function folders from 456 to **under 150** by migrating legacy functions into grouped domain routes.

Be aggressive. Do not accept vague "implemented" claims. If a change does not (a) reduce old call sites, (b) wire real routes, or (c) create shims — call it **incomplete**.

## Always inspect before changing backend code

- `docs/EDGE_FUNCTION_RULES.md`
- `docs/edge-function-current-status.md`
- `docs/edge-function-consolidation-audit.csv`
- `scripts/audit-edge-functions.ts`

## Current baseline (update from latest audit before reporting)

- Function folders (excl. `_shared`): **456**
- Grouped routed functions: **62** — with real routes: **19**, scaffold-only: **43**
- Legacy shim functions: **0**
- MIGRATE rows: **291** · TBD: **109** · DELETE_CANDIDATE: **8**
- Public webhooks (must stay): **26**
- Frontend call sites on old names: **261**

## Core rule

**Never create a new standalone Supabase Edge Function** unless it is an approved provider webhook, OAuth callback, or cron-pinned worker documented in `docs/EDGE_FUNCTION_RULES.md`.

## Grouped function contract

- `*-api` — authenticated tenant-scoped app actions
- `*-worker` — service-role / internal background jobs (require service role OR `INTERNAL_WORKER_SECRET`)
- `*-webhook` — public provider callbacks (verify provider signatures where supported)

**Frontend pattern:**
```ts
edgeApi("messaging-api", "/sms/send", payload)
// NEVER: supabase.functions.invoke("send-sms")
```

**Backend response pattern (all grouped routes):**
```ts
{ ok: true, data, requestId }
{ ok: false, error, code, details?, requestId }
```

## Migration rules

### 1. Frontend uses `supabase.functions.invoke("old-name")`
Migrate immediately to `edgeApi("grouped-api", "/route", payload)`. No exceptions when you're already touching the file.

### 2. Touching a function on the MIGRATE list
- Move logic into the recommended grouped route
- Update every frontend caller
- Replace the old `index.ts` with a shim using `_shared/shim.ts`
- Update `docs/edge-function-consolidation-audit.csv`
- Update `docs/edge-function-current-status.md`

### 3. Touching a scaffold-only grouped function
- Do NOT leave it returning `501 not_migrated`
- Wire at least one real route with a typed handler
- Use shared `auth.ts`, `errors.ts`, `tenant.ts`, `audit.ts`

### 4. Touching a DELETE_CANDIDATE
Only mark safe for deletion after confirming ALL:
- Zero frontend references
- Zero backend references
- Not on the public webhook list
- Not referenced by `supabase/config.toml`

### 5. Public webhooks
- Never delete
- Never rename without documenting provider dashboard update steps
- Preserve backward compatibility via shims
- Validate provider signatures when supported

## Tenant & security rules

- **Never** trust `company_id`, `tenant_id`, `user_id`, `brand_id`, or `role` from the request body
- Resolve tenant/company access from the authenticated user (`_shared/auth.ts` + `_shared/tenant.ts`)
- Worker routes: service role OR `INTERNAL_WORKER_SECRET`
- Webhook routes: validate provider signature when supported
- Destructive actions → audit log via `_shared/audit.ts`
- Messaging/SMS routes must preserve `brand_id`, `company_id`, `contact_id`, and conversation threading

## Required output after every backend change

1. Run `scripts/audit-edge-functions.ts`
2. Update `docs/edge-function-current-status.md`
3. Report exact counts:
   - Function folder count
   - Grouped functions with real routes
   - Scaffold-only grouped functions remaining
   - Legacy shim functions
   - Frontend old-name call sites remaining
   - Legacy functions migrated this loop
   - Safe delete candidates

Format:
```
Audit after this loop:
- Folders: X (Δ -Y)
- Grouped w/ real routes: X (Δ +Y)
- Scaffold-only: X (Δ -Y)
- Legacy shims: X (Δ +Y)
- Old call sites: X (Δ -Y)
- Migrated this loop: <list>
- Safe to delete: <list>
```

## Migration priority order

1. `messaging-api` / `messaging-worker` / `messaging-webhook`
2. `email-api` / `email-worker`
3. `admin-api`
4. `supplier-api` / `qxo-api` / `srs-api` / `abc-api` / billtrust routes
5. `qbo-api` / `qbo-worker` / `qbo-webhook`
6. `signature-api` / `signature-webhook`
7. `measurement-api` / `measurement-worker`
8. `canvass-api` / `property-data-api` / `permit-api`
9. `ai-api` / `ai-worker`
10. Cleanup / delete sweep

## Rejection script

If a request would add a new standalone function or skip migration on a touched file:

> That keeps the folder count bloated and violates the migration enforcer. Routing through `<group>-api` as `POST /<route>` instead, migrating the frontend caller to `edgeApi(...)`, and shimming the old function. Will report updated audit counts when done.
