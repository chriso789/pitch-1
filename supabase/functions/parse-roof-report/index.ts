// LEGACY SHIM — forwards to document-worker /parse/roof-report.
// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
//
// document-worker /parse/roof-report now supports BOTH:
//   - { document_id }                     → persisted run
//   - { bucket, path } / { storage_path } → transient parse, no persistence
//
// Legacy callers that POST `{ measurements, scope_project_id }` (manual entry of
// roof report numbers, not actual PDF parsing) must migrate to
// `generate-estimate-from-measurement`; this shim returns a clear error in that
// case rather than silently dropping into a missing legacy implementation.
import { corsHeaders } from "../_shared/router.ts";
import { forward } from "../_shared/shim.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const cloned = req.clone();
  const body = await cloned.json().catch(() => ({}));
  const hasDoc = body && typeof body === "object" && (
    "document_id" in body || "bucket" in body || "storage_path" in body
  );
  if (hasDoc) {
    return forward(req, "document-worker", "/parse/roof-report", "parse-roof-report");
  }
  return new Response(
    JSON.stringify({
      ok: false,
      code: "migration_required",
      error: "parse-roof-report no longer accepts { measurements } payloads. Call generate-estimate-from-measurement directly.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
