// LEGACY SHIM — forwards to pdf-api /extract-text.
// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
import { corsHeaders } from "../_shared/router.ts";
import { forward } from "../_shared/shim.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return forward(req, "pdf-api", "/extract-text", "pdf-extract-text");
});
