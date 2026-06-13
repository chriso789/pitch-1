// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// qxo-submit-order → qxo-api /orders/submit. Never loads QXO credentials. Ignores body.tenant_id.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "qxo-api", "/orders/submit", "qxo-submit-order"));
