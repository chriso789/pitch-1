// Delegation helper for grouped routed functions.
// During consolidation, grouped routes (messaging-api etc.) forward to legacy
// function implementations to preserve table writes & external integrations.
// Frontends migrate to the grouped name now; the legacy logic is ported inline
// later. This is the inverse of `_shared/shim.ts` (legacy → grouped).
//
// IMPORTANT: never call `delegate` to a target that is itself shimmed back to
// the grouped function — that creates an infinite loop. The consolidation
// audit doc tracks which legacy functions are "delegated to" vs "shimmed".

import { corsHeaders } from "./router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export type DelegateOptions = {
  /** Override body sent to the legacy function (defaults to original body). */
  body?: unknown;
  /** Add or override headers sent to the legacy function. */
  headers?: Record<string, string>;
  /** If true, force the Authorization header to use the service-role key. */
  serviceRole?: boolean;
  /** If true, force the Authorization header to the anon key (preserves no user). */
  anon?: boolean;
};

/**
 * Forward a request to a legacy Edge Function and return its raw response.
 * Preserves CORS headers and labels the call via `x-delegated-from`.
 */
export async function delegate(
  req: Request,
  targetFn: string,
  fromFn: string,
  opts: DelegateOptions = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = `${SUPABASE_URL}/functions/v1/${targetFn}`;
  const headers = new Headers();

  // Carry through Content-Type and provider headers verbatim
  for (const [k, v] of req.headers.entries()) {
    const lk = k.toLowerCase();
    if (
      lk === "host" || lk === "content-length" ||
      lk === "connection" || lk === "accept-encoding"
    ) continue;
    headers.set(k, v);
  }

  // Auth override
  if (opts.serviceRole) {
    headers.set("Authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
    headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY);
  } else if (opts.anon) {
    headers.set("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    headers.set("apikey", SUPABASE_ANON_KEY);
  }
  headers.set("x-delegated-from", fromFn);

  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(url, { method: req.method, headers, body });
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `delegate_failed: ${String(e)}`,
        code: "delegate_failed",
        target: targetFn,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const outHeaders = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) outHeaders.set(k, v);
  return new Response(res.body, { status: res.status, headers: outHeaders });
}
