// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `ai-error-fixer` invocations to the grouped `ai-api` route `/error/fix`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "ai-api", "/error/fix", "ai-error-fixer"));
