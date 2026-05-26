## Phase 1b: Add QBO secrets and unify webhook verifier env-var naming

### 1. Add the 5 QBO secrets (via `secrets--add_secret`)

| Secret | What to paste |
|---|---|
| `QBO_CLIENT_ID` | Intuit → Keys & credentials → Client ID (matching the environment chosen below) |
| `QBO_CLIENT_SECRET` | Intuit → Keys & credentials → Client Secret |
| `QBO_REDIRECT_URI` | `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback` |
| `QBO_ENVIRONMENT` | Exactly `sandbox` or `production` (anything else falls through to production in `_shared/qbo-auth.ts`) |
| `QBO_WEBHOOK_VERIFIER_TOKEN` | Intuit Developer Dashboard → My App → Webhooks → **Verifier Token** (Development tab for sandbox, Production tab for live). Leave blank for now if webhooks aren't configured yet — can be added later. |

User action required outside Lovable:
- In Intuit Dashboard → Keys & credentials → Redirect URIs (Production or Development tab matching `QBO_ENVIRONMENT`), **remove** `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl` and add the callback URL above. Save.

### 2. Resolve env-var naming mismatch (one tiny code change)

The repo currently has two readers:
- New `_shared/qbo-auth.ts` → reads `QBO_WEBHOOK_VERIFIER_TOKEN`
- Legacy `supabase/functions/qbo-webhook-handler/index.ts` → reads `QBO_WEBHOOK_VERIFIER`

To avoid setting the same secret twice, patch the legacy handler to fall back:

```ts
const verifier =
  Deno.env.get("QBO_WEBHOOK_VERIFIER_TOKEN") ??
  Deno.env.get("QBO_WEBHOOK_VERIFIER");
```

That way only `QBO_WEBHOOK_VERIFIER_TOKEN` needs to be set. The legacy `QBO_WEBHOOK_VERIFIER` remains a valid alias for any in-flight deploys.

### 3. Out of scope (deferred)
- No refactor of `qbo-webhook-handler` beyond the 3-line env fallback.
- `qbo-webhook/index.ts` stays scaffolded (501) — Intuit webhook URL should point at `qbo-webhook-handler` for now.
- `qbo-worker/.env.sample` cleanup of `USE_SANDBOX=1` happens in Phase 2 consolidation.

### 4. Validation
- After secrets are saved, `fetch_secrets` should show all 5 names.
- Smoke test: call `qbo-oauth-connect?action=initiate` from Settings → expect an Intuit authorize URL containing the correct host (`appcenter.intuit.com/connect/oauth2`).
- Complete OAuth round-trip in sandbox first if `QBO_ENVIRONMENT=sandbox`.
