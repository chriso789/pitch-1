// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// qxo-submit-quote-order → qxo-api /orders/submit-quote. Never loads QXO credentials.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "qxo-api", "/orders/submit-quote", "qxo-submit-quote-order"));
