// Public verification endpoint: returns which tenant a PITCH_CRM_API_KEY resolves to.
// Safe to call from the OBC Growth Hub project to confirm key↔tenant linking.
// No lead is written.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Accept api_key from JSON body, x-api-key header, or ?api_key=
    let apiKey = req.headers.get("x-api-key") ?? "";
    if (!apiKey) {
      const url = new URL(req.url);
      apiKey = url.searchParams.get("api_key") ?? "";
    }
    if (!apiKey && req.method !== "GET") {
      try {
        const body = await req.json();
        apiKey = body?.api_key ?? "";
      } catch (_) { /* ignore */ }
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "api_key is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const keyHash = await hashApiKey(apiKey);
    const keyPrefix = apiKey.substring(0, 8);

    const { data: keyRow, error: keyErr } = await supabase
      .from("company_api_keys")
      .select("id, tenant_id, name, is_active, revoked_at, created_at, last_used_at, usage_count")
      .eq("api_key_hash", keyHash)
      .maybeSingle();

    if (keyErr) {
      return new Response(
        JSON.stringify({ ok: false, error: "lookup_failed", details: keyErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!keyRow) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "api_key_not_found",
          key_prefix: keyPrefix,
          message: "This API key does not exist in Pitch CRM. Confirm it was created on the Pitch side.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve tenant name
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name")
      .eq("id", keyRow.tenant_id)
      .maybeSingle();

    const EXPECTED_OBC_TENANT_ID = "14de934e-7964-4afd-940a-620d2ace125d";
    const matches_obrien = keyRow.tenant_id === EXPECTED_OBC_TENANT_ID;

    return new Response(
      JSON.stringify({
        ok: true,
        key_prefix: keyPrefix,
        api_key_id: keyRow.id,
        api_key_name: keyRow.name,
        is_active: keyRow.is_active,
        revoked_at: keyRow.revoked_at,
        created_at: keyRow.created_at,
        last_used_at: keyRow.last_used_at,
        usage_count: keyRow.usage_count,
        tenant_id: keyRow.tenant_id,
        tenant_name: tenant?.name ?? null,
        expected_tenant_id: EXPECTED_OBC_TENANT_ID,
        matches_obrien_contracting: matches_obrien,
        verdict: matches_obrien
          ? "✅ Key resolves to O'Brien Contracting — safe to push leads."
          : `❌ Key resolves to "${tenant?.name ?? keyRow.tenant_id}", NOT O'Brien Contracting. Do not push.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "unexpected", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
