// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.
// qxo-pricing → qxo-api /pricing/lookup.
//
// SECURITY NOTE: The legacy implementation called the QXO API with a single
// global QXO_API_KEY shared across all tenants. That violates the
// third-party-aggregator contract (each tenant must use their own connection).
// This shim forwards every call to the tenant-scoped /pricing/lookup route
// instead. The global QXO_API_KEY env var is no longer read.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "qxo-api", "/pricing/lookup", "qxo-pricing"));
