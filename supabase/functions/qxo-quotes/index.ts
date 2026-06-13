// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// qxo-quotes → qxo-api routes (action-based). Never loads QXO credentials. Ignores body.tenant_id.
import { corsHeaders } from "../_shared/router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const ACTION_TO_ROUTE: Record<string, string> = {
  detail: "/quotes/detail",
  list: "/quotes/list",
  revise: "/quotes/revise",
  reject: "/quotes/reject",
  submit: "/quotes/submit",
  submitDelegated: "/quotes/submit",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  let bodyBytes: Uint8Array | null = null;
  let action = url.searchParams.get("action") || "detail";
  if (req.method !== "GET" && req.method !== "HEAD") {
    bodyBytes = new Uint8Array(await req.arrayBuffer());
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
      if (parsed?.action) action = String(parsed.action);
    } catch { /* ignore */ }
  }

  const route = ACTION_TO_ROUTE[action] ?? "/quotes/detail";
  const headers = new Headers(req.headers);
  headers.set("x-shim-from", "qxo-quotes");
  headers.set("x-route", route);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/qxo-api${route}`, {
      method: req.method,
      headers,
      body: bodyBytes ?? undefined,
    });
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, code: "shim_forward_failed", error: String(e) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
