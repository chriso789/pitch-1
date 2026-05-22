// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `canvassiq-skip-trace` invocations to the grouped `property-data-api` route `/skip-trace`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "property-data-api", "/skip-trace", "canvassiq-skip-trace"));
