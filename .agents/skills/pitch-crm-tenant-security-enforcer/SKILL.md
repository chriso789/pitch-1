---
name: pitch-crm-tenant-security-enforcer
description: Enforce multi-tenant isolation, RLS, auth mode declaration, webhook signature verification, secret hygiene, and audit logging on every Pitch CRM backend, edge function, SQL migration, and frontend change. Auto-loads when touching Supabase queries, edge functions, RLS policies, webhooks, integrations (Telnyx/Stripe/QBO/QXO/ABC/SRS/Billtrust/DocuSign/OpenAI/Anthropic/Mapbox), storage buckets, signed links, customer portal routes, AI assistant context, bulk messaging, or any code dealing with company_id / tenant_id / brand_id / location_id.
---

# Pitch CRM Tenant Security Enforcer

Be strict. **Reject insecure implementations.** Do not mark work complete unless tenant isolation, declared auth mode, RLS, and audit requirements are all satisfied.

Pitch CRM is a multi-tenant SaaS. Every user, company, contact, lead, job, estimate, message, document, invoice, measurement, order, and integration credential MUST be isolated by `company_id` / tenant ownership. Backend or frontend code that exposes one company's data to another is a P0 bug — block the change.

## Hard rules (never violate)

### Identity & tenant resolution
1. **Never trust `company_id`, `tenant_id`, `brand_id`, `location_id`, `user_id`, `role`, or `permissions` from the request body.**
2. Resolve the authenticated user from the JWT (`getClaims(token)` → `claims.sub`).
3. Resolve company access from DB membership tables (`user_company_access`, `profiles`, `company_users`, or the existing access model in the repo) via `_shared/auth.ts` + `_shared/tenant.ts`.
4. If a request includes `company_id`, verify the authenticated user belongs to that company before using it.
5. **Service role bypasses RLS** — when used, manually enforce `.eq('company_id', resolvedCompanyId)` (or `tenant_id`) on every query.
6. **Never use service role in frontend code.**

### Secret hygiene
7. Never expose to the browser: service role keys, provider API keys, webhook secrets, OAuth client secrets, Telnyx/Stripe/QBO/QXO/ABC/SRS/Billtrust/DocuSign/OpenAI/Anthropic/Mapbox secret tokens, or database URLs.
8. All provider credentials stored server-side only, read via `Deno.env.get(...)` (or `_shared/env.ts`).
9. Integration credentials scoped by `company_id`; never reused across tenants.

### Database & RLS
10. Any table holding customer, job, document, lead, SMS, call, invoice, estimate, supplier, payment, measurement, or file data MUST have tenant-aware RLS.
11. On new tables: `ENABLE ROW LEVEL SECURITY` + SELECT/INSERT/UPDATE/DELETE policies based on company membership. Add indexes on `company_id`, `created_at`, `contact_id`, `job_id`, `user_id`, and provider IDs.
12. No permissive `USING (true)` policies unless the table is public by design and explicitly documented.
13. Avoid `SECURITY DEFINER` functions unless necessary; when used, `SET search_path = public` and enforce tenant checks inside.

### Storage & public links
14. Storage buckets enforce tenant/company path isolation. File paths MUST start with `{tenant_id}/...`. Use `safeStorageUpload`.
15. Signed/public links use expiring tokens and only reveal the specific document/proposal/report intended.
16. Public customer portal routes verify magic-link tokens or signed view tokens before returning data.

### Webhooks
17. Webhook routes verify provider signatures where supported.
18. Telnyx inbound SMS/call webhooks resolve the receiving number → correct `company_id` + `brand_id` before writing.
19. SMS replies attach to the correct contact/conversation; never cross brands or companies.
20. Email webhooks resolve message → contact → company → thread safely.
21. Stripe webhooks verify signature and map accounts/customers/subscriptions to the correct tenant.

### Integrations
22. QBO, QXO, ABC, SRS, Billtrust, and supplier integrations only access the credential record owned by the active company.

### AI
23. AI routes only load context for the authenticated user's company.
24. AI assistant answers MUST NOT summarize another company's jobs, contacts, messages, financials, or documents.

### Audit & destructive actions
25. Audit logs required for: destructive actions, admin actions, permission changes, webhook failures, credential updates, payment events, bulk messaging. Use `_shared/audit.ts`.
26. Destructive actions require elevated role checks.
27. Bulk messaging checks DNC/compliance gates before sending.

### Files & reports
28. File uploads validate file ownership, bucket path, MIME type, and company scope.
29. Generated PDFs/reports store `company_id` and owner metadata.

### Route auth-mode declaration (mandatory)
30. Every new route inside a grouped edge function MUST declare its auth mode, one of:
    - **authenticated tenant route** — `requireAuth` + `requireTenant`
    - **service-role / internal worker route** — requires `INTERNAL_WORKER_SECRET` or service role, + manual `company_id` filtering + audit log
    - **public webhook route** — signature verification + tenant resolution from provider payload
    - **public signed-token route** — token validation + scope check
31. A route without a declared auth mode is **incomplete**. Reject.
32. Any route using service role MUST include manual `company_id` filtering and audit logging.
33. Any route querying without `company_id`/`tenant_id` filter is flagged unless it is a documented platform-admin-only route.

## Edge function checklist

- Use `_shared/auth.ts`, `_shared/tenant.ts`, `_shared/router.ts`, `_shared/errors.ts`, `_shared/audit.ts`, `_shared/env.ts`, `_shared/rateLimit.ts`.
- Validate request JSON with Zod (or compatible) BEFORE use; return 400 with field errors on failure.
- Safe errors only: never leak secrets, stack traces, SQL errors, provider responses containing credentials, or raw tokens.
- Response envelope:
  ```json
  { "ok": true,  "data": ..., "requestId": "..." }
  { "ok": false, "error": "...", "code": "...", "details": ..., "requestId": "..." }
  ```

## Frontend checklist

- Don't fetch tenant data directly when an edge route is required for security boundaries.
- Don't store provider secrets in `localStorage`, `sessionStorage`, browser state, or public env vars. Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (anon) belong in the client.
- Don't render hidden admin/security fields to non-admin users.
- Use role-aware UI but **never rely on UI-only restrictions** — server enforces.
- Always filter tenant-scoped queries explicitly: `.eq('tenant_id', useEffectiveTenantId())`.

## Pre-completion review (run on every change)

1. Could this expose one company's data to another company?
2. Could a user spoof `company_id` or `brand_id`?
3. Could service role bypass RLS without manual filtering?
4. Could a webhook write data to the wrong tenant?
5. Could AI retrieve cross-tenant context?
6. Could a public link expose more than intended?
7. Could credentials leak to the browser?
8. Are audit logs written for sensitive actions?

If any answer is **yes** or **uncertain**, stop and fix before completing the task.

## Rejection script

When a change violates a rule, respond like:

> Blocking this change: it [reads `company_id` from the request body / uses service role without manual tenant filtering / exposes a provider secret to the browser / adds a webhook without signature verification / lacks a declared auth mode]. Fixing by [resolve tenant from JWT via `_shared/tenant.ts` / add `.eq('company_id', resolvedCompanyId)` + audit log / move secret to `Deno.env` and call from edge function / verify provider signature before processing / declare route as authenticated tenant route]. Then proceeding.

Then implement the secure version.
