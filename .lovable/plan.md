## Why the button still appears broken

The toast `Connection Failed: Edge Function returned a non-2xx status code` is the **generic** `supabase-js` v2 message — it does **not** contain the real reason. Until we surface the real error, every fix is guesswork.

Confirmed facts:
- `qbo-oauth-connect` **is deployed** and reachable (manual curl returned a clean 400 with `{"error":"Unauthorized"}` when called without a session).
- All required secrets exist: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`.
- The function's permission gate only allows roles: `master | owner | office_admin | corporate`. Your tenant also has users with `project_manager`, `sales_manager`, `regional_manager` — if the signed-in user has one of those roles, `initiate` returns HTTP 400 `Insufficient permissions (role: ...)` and the UI just shows the generic toast.
- No `qbo-oauth-connect` rows appear in `function_edge_logs` for recent clicks, which is consistent with either (a) the response being rejected before logging finalizes, or (b) the click producing the 400 we expect from the role gate.

## Plan (single narrow change set)

### 1. Surface the real edge-function error in the UI
In `src/components/settings/QuickBooksSettings.tsx`, replace the three `error.message` toasts (`handleConnect`, OAuth callback handler, `handleDisconnect`) with a helper that reads the JSON body from `FunctionsHttpError` and falls back to `error.message`:

```ts
async function extractFnError(err: any): Promise<string> {
  try {
    const res = err?.context?.response ?? err?.context;
    if (res && typeof res.json === 'function') {
      const body = await res.clone().json();
      if (body?.error) return body.error;
    }
  } catch {}
  return err?.message ?? 'Unknown error';
}
```

Result: the toast will read e.g. `Insufficient permissions (role: project_manager)` or `QuickBooks integration is not configured (...)` instead of the generic string. This alone unblocks every future iteration.

### 2. Add a `verify` / `status` echo endpoint to the edge function (optional but cheap)
Add an `action === 'verify'` branch in `supabase/functions/qbo-oauth-connect/index.ts` that returns `{ ok: true, role, tenant_id, hasClientId, hasSecret, hasRedirect, envName }` — no side effects, lets the UI (and us) confirm the exact cause without OAuth.

### 3. Decide on the role allowlist
After step 1 shows the real role, do exactly **one** of:
- (a) The signed-in user is `owner` / `master` and the failure is a different error string → fix that specific cause (e.g. missing `qbo_connections` unique index on `(tenant_id, realm_id)` if `initiate` is fine but `callback` fails on upsert).
- (b) The signed-in user is `project_manager` / etc. → either log in as `owner`/`master`, or extend the allowlist in `qbo-oauth-connect` (and matching client-side gating). I will NOT widen the allowlist silently — that's a permissions decision.

### 4. Verify
- Click **Connect to QuickBooks** in preview, read the now-specific toast.
- Confirm via `function_edge_logs` filtered by `qbo-oauth-connect` that the request hit the function and what status it returned.
- Apply the targeted fix from step 3 and rerun.

## Files touched
- `src/components/settings/QuickBooksSettings.tsx` — error extraction helper + 3 toast call-sites.
- `supabase/functions/qbo-oauth-connect/index.ts` — add `action: 'verify'` branch (read-only).

## Out of scope
- No DB schema changes.
- No allowlist change until step 1 tells us which role is actually being rejected.
- No measurement-system / canvass / pipeline code.

## Acceptance
- Clicking **Connect to QuickBooks** shows a toast containing the exact server-side `error` string (role, missing env, or token-exchange detail).
- `function_edge_logs` shows the `qbo-oauth-connect` invocation with its actual status code.
- Based on the surfaced reason, the next single targeted fix lands the OAuth window.
