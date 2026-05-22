// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `ai-image-analyzer` invocations to the grouped `ai-api` route `/image/analyze`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "ai-api", "/image/analyze", "ai-image-analyzer"));
