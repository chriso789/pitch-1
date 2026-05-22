# Edge Function Rules

Policy for any code that touches `supabase/functions/`.

## Core rules

1. **Never create one Edge Function per button.** Add a new route to an existing routed `*-api` function instead.
2. **Domain functions only.** All new logic must land in one of:
   - `*-api` — authenticated, tenant-scoped REST surface
   - `*-worker` — cron- or queue-driven background processors
   - `*-webhook` — public endpoints receiving provider callbacks
3. **Public webhooks may remain as standalone functions** when an external provider's callback URL points at a specific function name and changing it requires a manual ops step. Document the provider + dashboard URL in `docs/EDGE_FUNCTION_DELETE_CANDIDATES.md`.
4. **Workers may remain standalone** when they are invoked by a Supabase cron, pg_cron job, or queue trigger that addresses them by name.
5. **Provider integrations route through `supplier-api`, `payment-api`, `messaging-api`, `telnyx-api`, `qbo-api`, etc.** Do not add a new `<provider>-<action>` function.
6. **Every new function must be justified** in a PR description and documented in `docs/EDGE_FUNCTION_RULES.md` under "Approved exceptions".

## Routing convention

Frontend calls go through the helper:

```ts
import { edgeApi } from "@/lib/edgeApi";
const { data, error } = await edgeApi("messaging-api", "/sms/send", { to, message });
```

Internally this calls `supabase.functions.invoke("messaging-api", { body: { __route: "/sms/send", ...payload } })`. Routed functions read `__route` (or the `x-route` header) and dispatch via Hono.

## Response envelope

All routed functions must return:

```json
{ "ok": true|false, "data"?: any, "error"?: "human message", "code"?: "machine_code", "requestId": "uuid" }
```

`code` values are stable; UI may switch on them.

## Auth + tenancy

- Default: `requireAuth` + `requireTenant` middleware from `_shared/router.ts`.
- Public routes (webhooks, signed-link viewers) skip both and validate provider signatures inline.
- Body-supplied `tenant_id` is **always ignored**; the value comes from `user_company_access`.

## Shim policy

Legacy function folders forward to the new routed endpoint via `_shared/shim.ts`. Shims:

- Preserve method, headers, body verbatim.
- Add `x-shim-from: <old-name>`.
- Log to `edge_function_audit` so we can see when shim traffic stops.
- Carry the comment `TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.`

## Approved exceptions

_(add entries when introducing a non-routed function)_

- `stripe-webhook-handler` — provider webhook, signature-verified, points at fixed Stripe URL.
- `telnyx-*-webhook` — provider webhooks pointing at fixed Telnyx URLs.
- `qbo-webhook-handler` — QuickBooks Online webhook URL.
- `docusign-webhook` — DocuSign Connect URL.
- `abc-oauth-callback`, OAuth callbacks — provider redirect URLs.
- Cron-pinned workers listed in `supabase/config.toml`.
