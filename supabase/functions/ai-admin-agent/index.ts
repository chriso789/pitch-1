// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `ai-admin-agent` invocations to the grouped `ai-api` route `/admin`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "ai-api", "/admin", "ai-admin-agent"));
