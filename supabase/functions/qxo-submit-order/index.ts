// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// qxo-submit-order → qxo-api /orders/submit. Never loads QXO credentials. Tenant resolved server-side from auth, never from the request body.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "qxo-api", "/orders/submit", "qxo-submit-order"));
