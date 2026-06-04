// measurement-worker — routed Edge Function.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient, serveRouter } from "../_shared/router.ts";
import { writeSkillArtifact } from "../_shared/mskill/artifacts.ts";

const app = createRouter("measurement-worker");

app.get("/__health", (c) => jsonOk(c, { fn: "measurement-worker", ok: true }));

// ---------------------------------------------------------------------------
// Internal compute-worker callback. Authed via INTERNAL_WORKER_API_KEY (new,
// standardized) with fallback to legacy INTERNAL_WORKER_SECRET — NO user JWT.
// Mounted BEFORE requireAuth so the external worker can call it.
// ---------------------------------------------------------------------------
app.post("/worker/callback", async (c) => {
  const provided =
    c.req.header("x-internal-worker-api-key") ??
    c.req.header("x-internal-worker-secret") ??
    "";
  const expected =
    Deno.env.get("INTERNAL_WORKER_API_KEY") ??
    Deno.env.get("INTERNAL_WORKER_SECRET") ??
    "";
  if (!expected || provided !== expected) {
    return jsonErr(c, "unauthorized", "invalid internal worker api key", 401);
  }
  const body = await c.req.json().catch(() => ({}));
  const runId = String(body.mskill_run_id ?? "");
  const requestHash = String(body.request_hash ?? "");
  const status = String(body.status ?? "completed");
  const outputPayload = body.output_payload ?? {};
  const errorMessage = body.error_message ?? null;
  const artifacts: Array<{ artifact_type: string; storage_path?: string; source_url?: string; byte_size?: number; metadata?: Record<string, unknown> }> = Array.isArray(body.artifacts) ? body.artifacts : [];
  if (!runId || !requestHash) return jsonErr(c, "bad_request", "mskill_run_id + request_hash required", 400);

  const svc = serviceClient();
  const { data: run } = await svc.from("mskill_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return jsonErr(c, "not_found", "run not found", 404);
  if (run.request_hash !== requestHash) {
    return jsonErr(c, "stale_request", "request_hash mismatch — refusing stale write", 409);
  }

  await svc.from("mskill_runs").update({
    status,
    output_payload: outputPayload,
    error_message: errorMessage,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  for (const a of artifacts) {
    if (!a.storage_path && !a.source_url) continue;
    await writeSkillArtifact(svc, {
      tenant_id: run.tenant_id,
      mskill_request_id: run.mskill_request_id,
      mskill_job_id: run.mskill_job_id,
      mskill_run_id: run.id,
      request_hash: run.request_hash,
    }, {
      artifact_type: a.artifact_type,
      storage_path: a.storage_path ?? null,
      source_url: a.source_url ?? null,
      byte_size: a.byte_size ?? null,
      metadata: a.metadata ?? {},
    });
  }

  return jsonOk(c, { ok: true, run_id: runId, status, artifacts_written: artifacts.length });
});

// Everything below requires user auth.
app.use("/*", requireAuth);
app.use("/*", requireTenant);

app.post("/auto-generate", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/learning-loop", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/batch/remeasure", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/batch/regenerate", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));
app.post("/benchmark/run", async (c) => jsonErr(c, "not_migrated", "Route scaffolded; logic not yet migrated.", 501));

serveRouter(app);
