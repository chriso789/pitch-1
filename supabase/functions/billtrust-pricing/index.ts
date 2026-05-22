// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `billtrust-pricing` invocations to the grouped `supplier-api` route `/billtrust/pricing`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "supplier-api", "/billtrust/pricing", "billtrust-pricing"));
