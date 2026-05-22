---
name: pitch-crm-architecture-guard
description: Enforces Pitch CRM backend architecture rules — prevents edge function sprawl, tenant leaks, unsafe Supabase patterns, and one-off Lovable-generated functions. Trigger on any backend, edge function, Supabase, webhook, worker, or new-feature work in the Pitch CRM project.
---

# Pitch CRM Architecture Guard

Be strict. If a request would unnecessarily increase the Supabase function folder count or violate any rule below, **reject that implementation path** and route the work into the correct grouped function instead. Explain the rejection briefly and propose the correct route.

## Hard rules (never violate)

### Edge function grouping
1. **Never create one Supabase Edge Function per button, feature, or small action.**
2. New backend logic must live inside an existing **grouped routed function**:
   - `*-api` — authenticated app/API actions
   - `*-worker` — background jobs, queues, cron, batch processing
   - `*-webhook` — public provider callbacks
3. Before creating ANY new edge function folder, read:
   - `docs/EDGE_FUNCTION_RULES.md`
   - `docs/edge-function-current-status.md`
4. If an old standalone function still exists, **migrate** it into the correct grouped route and replace the old folder with a shim using `supabase/functions/_shared/shim.ts`.
5. After any edge-function architecture change, **update `docs/edge-function-current-status.md`**.
6. Delete unused code only after audit confirms zero frontend, backend, webhook, cron, or provider dependency.
7. **Never delete a public webhook function** unless the provider dashboard URL has been confirmed updated.

### Frontend → backend calls
8. Frontend must call edge functions through:
   ```ts
   edgeApi("domain-api", "/route", payload)
   ```
   Do **not** use `supabase.functions.invoke("new-standalone-feature-name")` for new logic.

### Security & tenancy
9. **Never trust `company_id`, `tenant_id`, `brand_id`, or user role from the client body.** Resolve them server-side from the authenticated user.
10. Verify company access via authenticated user membership (use `_shared/auth.ts` + `_shared/tenant.ts`).
11. **Worker routes** must require service role OR `INTERNAL_WORKER_SECRET`.
12. **Webhook routes** must verify provider signatures where supported.
13. All destructive actions must write audit logs (`_shared/audit.ts`).
14. Never hardcode API keys, company IDs, user IDs, phone numbers, provider secrets, or webhook secrets. Use `Deno.env.get(...)` via `_shared/env.ts`.

### Shared helpers — prefer over rolling your own
Use `supabase/functions/_shared/`:
- `auth.ts` — JWT validation, user resolution
- `errors.ts` — consistent error responses
- `audit.ts` — audit logging
- `router.ts` — request routing inside grouped functions
- `tenant.ts` — server-side tenant/company resolution
- `rateLimit.ts` — rate limiting
- `env.ts` — secret access
- `shim.ts` — legacy function shim forwarder

## Workflow for a new backend feature

1. **Decide the grouped function**: which `*-api`, `*-worker`, or `*-webhook` owns this domain? Check `docs/edge-function-current-status.md`.
2. **Add a route** inside that grouped function via its router (`app.post("/your-route", handler)`).
3. **Update or create frontend hooks** to call `edgeApi("domain-api", "/your-route", payload)`.
4. **Add tests or audit-script coverage.**
5. **Update `docs/edge-function-current-status.md`** if grouping/scaffold status changed.
6. **Do not increase the Supabase function folder count** unless there is a documented, approved exception.

## Rejection script

When a request would create a new standalone function, respond like:

> That would add another standalone edge function and violate the architecture guard. Routing this through `<domain>-api` as `POST /<route>` instead. The frontend will call `edgeApi("<domain>-api", "/<route>", ...)`.

Then implement it the right way.
