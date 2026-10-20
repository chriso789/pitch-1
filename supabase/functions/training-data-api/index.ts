// training-data-api — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
import { trainingPhotoInventory, saveTrainingPreparation } from '../_shared/training-photo-inventory.ts';

const app = createRouter("training-data-api");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "training-data-api", ok: true }));

// Apply auth + tenant guard to everything else unless explicitly public.
app.use("/*", requireAuth);
app.post('/photos/inventory', (c) => trainingPhotoInventory(c));
app.post('/photos/batch', (c) => trainingPhotoInventory(c, true));
app.post('/photos/save', saveTrainingPreparation);
app.use("/*", requireTenant);

app.post("/pair/generate", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/batch", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/export", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/export/unet", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/export/aligned", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/extract", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/validate/inference", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/validate/milestone", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return app.fetch(req);
  const route = req.headers.get('x-route');
  if (route && /^\/photos\/(inventory|batch|save)$/.test(route)) {
    const url = new URL(req.url); url.pathname = route;
    return app.fetch(new Request(url, req));
  }
  return app.fetch(req);
});
