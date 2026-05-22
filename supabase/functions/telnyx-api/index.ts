// telnyx-api — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";

const app = createRouter("telnyx-api");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "telnyx-api", ok: true }));

// Apply auth + tenant guard to everything else unless explicitly public.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/sms/send", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/call/dial", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/numbers/search", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/numbers/purchase", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/numbers/configure", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/10dlc", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
