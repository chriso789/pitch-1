/**
 * Cloudflare Worker — QuickBooks OAuth production callback proxy.
 *
 * Intuit rejects raw infrastructure hostnames (*.supabase.co) as Production
 * Redirect URIs. This Worker lives on api.pitch-crm.ai and forwards the
 * exact Intuit callback (code, state, realmId, error, etc.) server-side to
 * the Supabase Edge Function that performs the token exchange.
 *
 * DNS:
 *   - Add a CNAME or orange-cloud A/AAAA record for api.pitch-crm.ai.
 *   - In Cloudflare, attach this Worker to the custom domain api.pitch-crm.ai.
 *
 * Saved in Intuit dashboard:
 *   https://api.pitch-crm.ai/qbo/callback
 */

const UPSTREAM = "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback";

export default {
  async fetch(request, env, ctx) {
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
      statusText: upstreamResp.statusText,
      headers: upstreamResp.headers,
    });
  },
};
