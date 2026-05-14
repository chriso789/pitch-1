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
        canonical_route: {
          created_by_function: "start-ai-measurement",
          created_by_component: "PullMeasurementsButton/useMeasurementJob",
          solver_entrypoint: "_shared/autonomous-graph-solver.solveAutonomousGraph",
          canonical_measurement_route: true,
          route_audit_version: "measurement-route-audit-v1",
          report_renderer_version: "render-measurement-pdf-v1",
        },
        phase3_versions: {
          phase3_engine_version: "phase3-visibility-v1",
          phase3A_eave_rake_classifier_version: "v1",
          phase3A_5_perimeter_refinement_version: "v1",
          phase3B_roof_lines_persistence_version: "v1-counts-only",
          phase3C_deferred_edges_version: "v1",
          phase3D_backbone_seed_version: "v1",
          phase3E_constraint_repair_version: "v1",
          phase3F_result_state_version: "v1",
          phase3G_diagram_render_intent_version: "v1",
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
