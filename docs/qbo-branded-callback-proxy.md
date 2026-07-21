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

## Option A — Cloudflare Worker (recommended)

DNS:

1. Add an `A`/`AAAA` or `CNAME` record for `api.pitch-crm.ai` pointing at Cloudflare (orange-cloud proxied).
2. In the Cloudflare dashboard: **Workers & Pages → Create Worker → Deploy** using the script below.
3. **Triggers → Custom Domains** → add `api.pitch-crm.ai`.

Worker script (`workers/qbo-callback.js`):

```js
const UPSTREAM = "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/qbo/callback") {
      return new Response("Not Found", { status: 404 });
    }

    // Preserve the full query string verbatim.
    const upstream = new URL(UPSTREAM);
    upstream.search = url.search;

    // Server-side forward. `redirect: "manual"` lets the edge function's
    // final 302 to /settings/integrations reach the browser unchanged.
    const upstreamResp = await fetch(upstream.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    });

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      headers: upstreamResp.headers,
    });
  },
};
```

## Option B — Supabase Edge Functions Custom Domain

If you're on Supabase Pro+, you can map a custom domain (`api.pitch-crm.ai`) directly to the Edge Functions router and route `/qbo/callback` to the existing function via a rewrite. See <https://supabase.com/docs/guides/functions/custom-domains>. No Worker required, but you lose the ability to add other Pitch API routes on the same host later without more config.

## Option C — Vercel / Next.js route

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

Then either point `api.pitch-crm.ai` at Vercel, or save the Intuit Production Redirect URI as `https://pitch-crm.ai/api/qbo/callback` and update `QBO_REDIRECT_URI_PRODUCTION` to match exactly.

## Backend secrets

```
QBO_REDIRECT_URI_PRODUCTION = https://api.pitch-crm.ai/qbo/callback
QBO_REDIRECT_URI_DEVELOPMENT = https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback
```

The Pitch code defaults to the branded URL in production even if the secret is unset, but you should set the secret explicitly so drift is impossible.

## Verification checklist

- [ ] `curl -I https://api.pitch-crm.ai/qbo/callback?code=x&state=y&realmId=z` returns a 2xx or a 302 from the upstream edge function (not a 404 / 5xx from Cloudflare).
- [ ] The proxy does **not** rewrite the query string.
- [ ] Intuit dashboard → **Production → Redirect URIs** shows `https://api.pitch-crm.ai/qbo/callback` exactly (no trailing slash).
- [ ] A tenant OAuth run lands on `https://pitch-crm.ai/settings/integrations?provider=qbo&status=connected` and a row appears in `qbo_connections` for the initiating `tenant_id`.
