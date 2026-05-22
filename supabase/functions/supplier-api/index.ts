// supplier-api — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";

const app = createRouter("supplier-api");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "supplier-api", ok: true }));

// Apply auth + tenant guard to everything else unless explicitly public.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/qxo/proxy", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/credentials/save", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/pricing", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/orders", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/quotes", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/order/push", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/order/submit", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/quote-order/submit", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/qxo/invoices", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/proxy", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/srs/pricing", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/abc/proxy", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/abc/oauth/callback", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/billtrust/auth", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/billtrust/pricing", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/pricing", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/quote/parse", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/create", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/material-order/fulfillment", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
