// supabase/functions/debug-measurement-runtime/index.ts
// Returns deployed runtime stamps so callers can prove which bundle is live.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Keep these in sync with start-ai-measurement/index.ts
const AI_MEASUREMENT_ENGINE_VERSION = "perimeter-phase0-v2-target-mask";
const PERIMETER_CONTRACT_VERSION = "perimeter-contract-v2";
const PHASE0_CONTROL_FLOW_VERSION = "phase0-before-any-perimeter-fail";
const GIT_COMMIT_SHA = Deno.env.get("GIT_COMMIT_SHA") || Deno.env.get("DENO_DEPLOYMENT_ID") || "unknown";
const DEPLOYED_AT = new Date().toISOString();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0] || "unknown";
const ENV_NAME = Deno.env.get("DENO_ENV") ?? Deno.env.get("ENVIRONMENT") ?? "production";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify(
      {
        ok: true,
        runtime: {
          ai_measurement_engine_version: AI_MEASUREMENT_ENGINE_VERSION,
          perimeter_contract_version: PERIMETER_CONTRACT_VERSION,
          phase0_control_flow_version: PHASE0_CONTROL_FLOW_VERSION,
          git_commit_sha: GIT_COMMIT_SHA,
          deployed_at: DEPLOYED_AT,
        },
        deployment: {
          supabase_project_ref: PROJECT_REF,
          environment: ENV_NAME,
          function_name: "debug-measurement-runtime",
        },
        legacy_token_audit: {
          note: "perimeter_inner_trace_detected / missed_roof_ratio / perimeter_to_mask_ratio are now guarded control-flow paths. If a measurement surfaces them without phase0 markers, the record predates this deploy.",
          legacy_strings_known: ["perimeter_inner_trace_detected", "missed_roof_ratio", "perimeter_to_mask_ratio"],
        },
        now: new Date().toISOString(),
      },
      null,
      2,
    ),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
