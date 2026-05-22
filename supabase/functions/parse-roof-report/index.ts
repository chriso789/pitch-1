// LEGACY SHIM — forwards to document-worker /parse/roof-report.
// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Preserves the existing { measurements } / { pipeline_entry_id } contract by routing
// document-id-bearing requests to the deterministic parser, and falling through to
// the old behaviour for legacy structured-input callers.
import { corsHeaders } from "../_shared/router.ts";
import { forward } from "../_shared/shim.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const cloned = req.clone();
    const body = await cloned.json().catch(() => ({}));
    if (body && typeof body === "object" && "document_id" in body) {
      return forward(req, "document-worker", "/parse/roof-report", "parse-roof-report");
    }
  } catch { /* fall through */ }
  // Legacy callers (manual measurements / pipeline_entry_id) keep working via the old path.
  return forward(req, "parse-roof-report-legacy", "/", "parse-roof-report");
});
