// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// qxo-push-order → qxo-api /orders/submit. Never loads QXO credentials. Tenant resolved server-side from auth, never from the request body.
// (The legacy "push" endpoint is functionally a less-strict version of submit; rolled into one route.)
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "qxo-api", "/orders/submit", "qxo-push-order"));
