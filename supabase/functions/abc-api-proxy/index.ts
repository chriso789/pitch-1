// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `abc-api-proxy` invocations to the grouped `supplier-api` route `/abc/proxy`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "supplier-api", "/abc/proxy", "abc-api-proxy"));
