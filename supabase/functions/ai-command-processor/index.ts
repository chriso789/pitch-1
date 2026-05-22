// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `ai-command-processor` invocations to the grouped `ai-api` route `/command/process`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "ai-api", "/command/process", "ai-command-processor"));
