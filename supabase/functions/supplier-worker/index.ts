// supplier-worker — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";

const app = createRouter("supplier-worker");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "supplier-worker", ok: true }));

// Apply auth + tenant guard to everything else unless explicitly public.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/qxo/sync", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/pricelist/import", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/pricing/refresh", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/orders/status-poll", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/sunniland/import", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/price-list/import", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/price-list/parse", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/process", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
