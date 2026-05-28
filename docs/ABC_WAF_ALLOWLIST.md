# ABC Supply API — WAF / Allowlist Notes

ABC's sandbox and production API endpoints sit behind an **Imperva / Incapsula WAF**.
Calls from Supabase Edge Function egress IPs are sometimes returned with HTML 403
challenge pages (containing `_Incapsula_Resource`, `incident_id`, or
"Request unsuccessful"). These are **not** real ABC responses.

## How the proxy detects it

`supabase/functions/abc-api-proxy/handler.ts` and the mirrored
`supabase/functions/supplier-api/abc-proxy-handler.ts` both expose `detectWaf()`
which inspects upstream response text for the signatures above. When triggered,
`callAbc()` returns a synthesized response:

```json
{ "status": 499, "json": { "waf": true, "upstream_status": <original> } }
```

`499` is reserved for this case so the diagnostics panel can render a dedicated
"WAF blocked" pill instead of a generic "API error".

## What to do when this happens

1. Capture the failing edge function invocation in the Supabase dashboard.
2. Note the egress IP from the response trace if available.
3. Request that ABC's API team (or your ABC integration partner) allowlist the
   observed Supabase egress IPs for the sandbox host.
4. Until the allowlist update lands, demo from a known-good network path or
   reuse an already-persisted sandbox order in the diagnostics card.

## UI behavior

- **API response pill**: shows `WAF blocked` (red).
- **Banner**: explicit message telling the operator this is a WAF block, not an
  ABC business error, and points back to this document.
- **Lifecycle**: Sent → WAF blocked → (no Confirmation, no Webhooks).

## Future work (post-demo)

- Persist observed egress IPs in `abc_api_audit.response_body` so the doc can
  reference real values.
- Add a dedicated relay/static-IP egress option once ABC confirms allowlist
  policy.
- Surface a "Retry via relay" button on the diagnostics card if/when relay is
  available.
