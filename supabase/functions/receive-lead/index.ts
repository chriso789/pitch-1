// Compatibility shim for Growth Hub's `push-to-pitch-crm` function.
//
// Growth Hub posts to `${PITCH_CRM_URL}/functions/v1/receive-lead` with a
// payload shape we don't control. The real receiver is `external-lead-webhook`
// which expects `{ api_key, lead: {...} }`. This shim:
//   1. accepts whatever shape Growth Hub sends
//   2. extracts the api_key from header (x-api-key) or body (api_key / apiKey)
//      and falls back to the GROWTH_HUB_API_KEY env secret
//   3. normalizes the lead fields onto the canonical envelope
//   4. forwards to external-lead-webhook and returns its response verbatim
//
// Keeping this here means Growth Hub does NOT need a redeploy to fix the URL.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FALLBACK_API_KEY = Deno.env.get("GROWTH_HUB_API_KEY") ?? "";

const LEAD_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
  "message",
  "lead_source",
  "source_url",
  "appointment_requested",
  "appointment_date",
  "appointment_time",
  "appointment_notes",
  "service_type",
  "custom_fields",
];

function pickLead(body: Record<string, unknown>): Record<string, unknown> {
  // If caller already nested under `lead`, use it.
  const nested = body.lead;
  if (nested && typeof nested === "object") return nested as Record<string, unknown>;

  // Otherwise grab the canonical fields from the top-level body.
  const lead: Record<string, unknown> = {};
  for (const k of LEAD_FIELDS) {
    if (body[k] !== undefined) lead[k] = body[k];
  }

  // Soft aliases Growth Hub may emit.
  if (!lead.first_name && body.firstName) lead.first_name = body.firstName;
  if (!lead.last_name && body.lastName) lead.last_name = body.lastName;
  if (!lead.zip && body.zip_code) lead.zip = body.zip_code;
  if (!lead.zip && body.postal_code) lead.zip = body.postal_code;
  if (!lead.lead_source && body.source) lead.lead_source = body.source;

  return lead;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const headerKey = req.headers.get("x-api-key") ?? "";
  const bodyKey =
    (typeof body.api_key === "string" && body.api_key) ||
    (typeof (body as any).apiKey === "string" && (body as any).apiKey) ||
    "";
  const apiKey = headerKey || bodyKey || FALLBACK_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "missing_api_key",
        hint:
          "Provide api_key in JSON body, x-api-key header, or set GROWTH_HUB_API_KEY secret on this project.",
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const lead = pickLead(body);
  const envelope = { api_key: apiKey, lead };

  const target = `${SUPABASE_URL}/functions/v1/external-lead-webhook`;
  const resp = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // external-lead-webhook is public (verify_jwt=false) but Supabase still
      // wants an apikey header to route to the function.
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
      "x-shim-from": "receive-lead",
    },
    body: JSON.stringify(envelope),
  });

  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: {
      ...corsHeaders,
      "Content-Type": resp.headers.get("Content-Type") ?? "application/json",
      "x-forwarded-to": "external-lead-webhook",
    },
  });
});
