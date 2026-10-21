// ai-worker — routed Edge Function.
// Scaffolded 2026-05-22. Routes return 501 until logic is migrated from legacy one-off functions.
// See docs/EDGE_FUNCTION_RULES.md for the consolidation policy.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serveRouter } from "../_shared/router.ts";
import { photoPreparationWorker } from '../_shared/photo-preparation-worker.ts';

const app = createRouter("ai-worker");

// Health probe (always public)
app.get("/__health", (c) => jsonOk(c, { fn: "ai-worker", ok: true }));

// Auth mode: internal worker secret, with scope derived from a DB lease.
app.post('/photos/claim', (c) => photoPreparationWorker(c, 'claim'));
app.post('/photos/finish', (c) => photoPreparationWorker(c, 'finish'));

// Apply auth + tenant guard to everything else unless explicitly public.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/claude/process", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/followup/dispatch", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/followup/run", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/followup/process", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

serveRouter(app);
