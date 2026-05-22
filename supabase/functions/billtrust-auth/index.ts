// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// Forwards legacy `billtrust-auth` invocations to the grouped `supplier-api` route `/billtrust/auth`.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "supplier-api", "/billtrust/auth", "billtrust-auth"));
