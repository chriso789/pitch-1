// training-data-api — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serveRouter } from "../_shared/router.ts";
import { trainingPhotoInventory, saveTrainingPreparation } from '../_shared/training-photo-inventory.ts';
import { photoPreparationApi } from '../_shared/photo-preparation-api.ts';
import { photoBrowserApi } from '../_shared/photo-browser-api.ts';

const app = createRouter("training-data-api");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "training-data-api", ok: true }));

// Apply auth + tenant guard to everything else unless explicitly public.
app.use("/*", requireAuth);
app.post('/photos/inventory', (c) => trainingPhotoInventory(c));
app.post('/photos/batch', (c) => trainingPhotoInventory(c, true));
app.post('/photos/save', saveTrainingPreparation);
// Auth mode: authenticated platform developer; private, consent-gated platform scope.
app.post('/photos/browser/start', (c) => photoBrowserApi(c, 'start'));
app.post('/photos/browser/read', (c) => photoBrowserApi(c, 'read'));
app.post('/photos/browser/save', (c) => photoBrowserApi(c, 'save'));
// Auth mode: authenticated platform developer; platform scope checked by RPC.
app.post('/photos/jobs/create', (c) => photoPreparationApi(c, 'create'));
app.post('/photos/jobs/list', (c) => photoPreparationApi(c, 'list'));
app.post('/photos/jobs/manage', (c) => photoPreparationApi(c, 'manage'));
app.post('/references/publish', (c) => photoPreparationApi(c, 'publish'));
app.use("/*", requireTenant);

app.post("/pair/generate", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/batch", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/export", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/export/unet", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/export/aligned", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/extract", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/validate/inference", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/validate/milestone", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

serveRouter(app);
