// signature-webhook — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";

const app = createRouter("signature-webhook");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "signature-webhook", ok: true }));

// Apply auth + tenant guard to everything else unless explicitly public.
// (public surface — auth applied per-route inside handlers as needed)

app.post("/docusign", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(app.fetch);
