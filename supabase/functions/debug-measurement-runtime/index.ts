// supabase/functions/debug-measurement-runtime/index.ts
// Returns the deployed runtime version stamps so you can prove which
// bundle of start-ai-measurement is actually executing.
import {
  AI_MEASUREMENT_ENGINE_VERSION,
  PERIMETER_CONTRACT_VERSION,
  PHASE0_CONTROL_FLOW_VERSION,
  GIT_COMMIT_SHA,
  DEPLOYED_AT,
  RUNTIME_VERSION_STAMP,
} from "../start-ai-measurement/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0] || "unknown";
const ENV_NAME = Deno.env.get("DENO_ENV") ?? Deno.env.get("ENVIRONMENT") ?? "production";
const FUNCTION_BOOT_AT = new Date().toISOString();

// Heuristic check: is the OLD global-mask hard-fail string still present in
// any code reachable from the current bundle? If we can't introspect (we
// can't read the running bundle from inside Deno), we surface the constants
// instead so callers can compare to the latest commit on disk.
const KNOWN_LEGACY_STRINGS = [
  "perimeter_inner_trace_detected",
  "missed_roof_ratio",
  "perimeter_to_mask_ratio",
];

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const payload = {
    ok: true,
    runtime: {
      ai_measurement_engine_version: AI_MEASUREMENT_ENGINE_VERSION,
      perimeter_contract_version: PERIMETER_CONTRACT_VERSION,
      phase0_control_flow_version: PHASE0_CONTROL_FLOW_VERSION,
      git_commit_sha: GIT_COMMIT_SHA,
      deployed_at: DEPLOYED_AT,
      function_boot_at: FUNCTION_BOOT_AT,
      runtime_version_stamp: RUNTIME_VERSION_STAMP,
    },
    deployment: {
      supabase_project_ref: PROJECT_REF,
      environment: ENV_NAME,
      function_name: "debug-measurement-runtime",
      imports_from: "start-ai-measurement",
    },
    legacy_token_audit: {
      note: "These tokens are now expected ONLY inside guarded control-flow paths. If a measurement still surfaces them as the *only* failure reason without phase0 markers, you are looking at a stale record.",
      legacy_strings_known: KNOWN_LEGACY_STRINGS,
    },
    now: new Date().toISOString(),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
