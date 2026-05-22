// Forwarding shim helper. Used by legacy function folders to relay invocations
// to the new routed API while logging deprecation usage.
//
// Usage in supabase/functions/<old-name>/index.ts:
//   import { forward } from "../_shared/shim.ts";
//   Deno.serve((req) => forward(req, "messaging-api", "/sms/send", "send-sms"));

import { corsHeaders } from "./router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

export async function forward(req: Request, targetFn: string, targetRoute: string, fromName: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = `${SUPABASE_URL}/functions/v1/${targetFn}${targetRoute}`;
  const headers = new Headers(req.headers);
  headers.set("x-shim-from", fromName);

  // For invoke() callers, body may be JSON with a `__route` field — leave it untouched.
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(url, { method: req.method, headers, body });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `shim_forward_failed: ${String(e)}`, code: "shim_forward_failed" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Pass through verbatim, ensure CORS headers present.
  const outHeaders = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) outHeaders.set(k, v);
  console.warn(`[shim] ${fromName} → ${targetFn}${targetRoute} (status=${res.status})`);
  return new Response(res.body, { status: res.status, headers: outHeaders });
}
