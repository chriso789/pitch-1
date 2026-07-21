# QuickBooks Production Callback — Branded Proxy Setup

Intuit rejects raw infrastructure hostnames (`*.supabase.co`, `*.vercel.app`, etc.) as **Production** Redirect URIs. Pitch's production OAuth callback must therefore be served from a branded SaaS domain:

```
https://api.pitch-crm.ai/qbo/callback
```

This URL is a **thin server-side proxy** that forwards the exact request to the Supabase Edge Function that already performs the OAuth code exchange, tenant resolution, and `qbo_connections` write:

```
https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback
```

## Contract

- **One shared callback for all tenants.** Tenant identity comes from the signed OAuth `state` record on the Pitch side, not from per-tenant URLs.
- **Preserve the full query string verbatim**: `code`, `state`, `realmId`, `error`, `error_description` (and anything else Intuit may add).
- **Server-side forward only** — do not render HTML at `/qbo/callback`, do not perform a browser 302 to the raw Supabase URL, and do not put the authorization code into the address bar of any intermediate page.
- **HTTPS only**, no trailing slash, exact path `/qbo/callback`.
- After the edge function finishes, it redirects the browser to
  `https://pitch-crm.ai/settings/integrations?provider=qbo&status=...`.

## Current status

- Intuit dashboard → **Production → Redirect URIs** should contain exactly:
  `https://api.pitch-crm.ai/qbo/callback`
- The Pitch edge function (`qbo-oauth-connect`) already defaults to this branded URI for production.
- The missing piece is making `api.pitch-crm.ai/qbo/callback` reachable on the public internet.

## How to make the proxy live

### Option A — Cloudflare Worker (recommended)

You need two things: DNS for `api.pitch-crm.ai` and a Worker that forwards to Supabase.

1. **DNS**
   - In your DNS host (usually Cloudflare if `pitch-crm.ai` is orange-cloud), add a record for `api.pitch-crm.ai`.
   - If using Cloudflare: create a `CNAME` from `api` to `cloudflareworkers.com` (or your Cloudflare account target) and keep the proxy enabled (orange cloud).
   - If your DNS is elsewhere: point `api.pitch-crm.ai` to Cloudflare nameservers first, or create an `A`/`AAAA` record to the Worker once the custom domain is assigned.

2. **Worker**
   - Go to **Cloudflare dashboard → Workers & Pages → Create a Service / Worker**.
   - Paste the contents of `workers/qbo-callback.js` from this repo.
   - Deploy.

3. **Custom domain trigger**
   - In the Worker, go to **Triggers → Custom Domains**.
   - Add `api.pitch-crm.ai`.
   - Cloudflare will issue a certificate; wait until the domain shows **Active**.

4. **Verify**
   ```bash
   curl -I "https://api.pitch-crm.ai/qbo/callback?code=test&state=test&realmId=test"
   ```
   You should get **HTTP 401** (the Supabase edge function rejects the fake state) — not a DNS error, not a 404 from Cloudflare, and not a browser HTML page.

### Option B — Supabase Edge Functions Custom Domain

If you're on Supabase Pro+, you can map a custom domain (`api.pitch-crm.ai`) directly to the Edge Functions router and route `/qbo/callback` to the existing function via a rewrite. See <https://supabase.com/docs/guides/functions/custom-domains>. No Worker required, but you lose the ability to add other Pitch API routes on the same host later without more config.

### Option C — Vercel / Next.js route

If you already host a marketing site at `pitch-crm.ai` on Vercel, add:

```ts
// app/api/qbo/callback/route.ts
export const runtime = "edge";
const UPSTREAM = "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const upstream = new URL(UPSTREAM);
  upstream.search = url.search;
  return fetch(upstream, { redirect: "manual" });
}
```

Then either point `api.pitch-crm.ai` at Vercel, or change the Intuit Production Redirect URI to `https://pitch-crm.ai/api/qbo/callback` and update `QBO_REDIRECT_URI_PRODUCTION` to match.

## Backend secrets

Set these in your Supabase project secrets (Edge Function settings):

```
QBO_REDIRECT_URI_PRODUCTION = https://api.pitch-crm.ai/qbo/callback
QBO_REDIRECT_URI_DEVELOPMENT = https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback
```

The Pitch code defaults to the branded URL in production even if the secret is unset, but you should set the secret explicitly so drift is impossible.

## Verification checklist

- [ ] `curl -I "https://api.pitch-crm.ai/qbo/callback?code=x&state=y&realmId=z"` returns **HTTP 401** from the upstream edge function (not DNS error, not 404, not HTML).
- [ ] The proxy does **not** rewrite the query string.
- [ ] Intuit dashboard → **Production → Redirect URIs** shows `https://api.pitch-crm.ai/qbo/callback` exactly (no trailing slash).
- [ ] A tenant OAuth run lands on `https://pitch-crm.ai/settings/integrations?provider=qbo&status=connected` and a row appears in `qbo_connections` for the initiating `tenant_id`.
