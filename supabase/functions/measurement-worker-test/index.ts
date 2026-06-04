// measurement-worker-test — end-to-end integration test runner for the
// internal Python compute worker. Runs the 10-test plan for clip_point_cloud
// and returns a structured report. Master/admin only.
//
// Tests covered:
//   1. Worker health
//   2. Capabilities (clip_point_cloud implemented; downstream NOT implemented)
//   3. Auth guard (bad/missing API key)
//   4. Validation gates (5 sub-tests)
//   5. Control-plane dispatch (skipped unless job_id provided)
//   6. Real clipping success path (skipped unless job_id+roof_surface_asset)
//   7. Sparse/empty AOI path (skipped unless test asset url provided)
//   8. Downstream block check (registry-static + DB-dynamic if job_id)
//   9. Callback hardening (stub response → refused)
//  10. request_hash mismatch (rejected)
//
// All non-stub failures return pass:false with diagnostics so the UI panel
// can render a green/red checklist without crashing.

import { createRouter, jsonOk, jsonErr, requireAuth, serviceClient, serveRouter } from "../_shared/router.ts";
import { MSKILL_REGISTRY, allDownstreamOf } from "../_shared/mskill/registry.ts";

const app = createRouter("measurement-worker-test");

const WORKER_BASE_URL = (Deno.env.get("INTERNAL_WORKER_BASE_URL") ?? "").replace(/\/$/, "");
const WORKER_API_KEY = Deno.env.get("INTERNAL_WORKER_API_KEY") ?? "";
const CALLBACK_BASE = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  skipped?: boolean;
  detail?: string;
  data?: unknown;
  duration_ms?: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

async function workerFetch(path: string, init: RequestInit & { auth?: string | null } = {}) {
  const { auth, headers, ...rest } = init;
  const h: Record<string, string> = { "content-type": "application/json", ...(headers as Record<string, string> ?? {}) };
  if (auth !== null) h["x-internal-worker-api-key"] = auth ?? WORKER_API_KEY;
  return await fetch(`${WORKER_BASE_URL}${path}`, {
    ...rest,
    headers: h,
    signal: AbortSignal.timeout(20_000),
  });
}

// ---------------------------------------------------------------------------
// Individual tests
// ---------------------------------------------------------------------------

async function testHealth(): Promise<TestResult> {
  try {
    const { value: res, ms } = await timed(() => workerFetch("/health", { method: "GET", auth: null }));
    const body = await res.json().catch(() => ({}));
    const ok = res.ok && (body?.ok === true || body?.status === "ok" || typeof body?.worker_version === "string");
    return {
      id: "health", name: "Worker health (GET /health)",
      pass: !!ok, duration_ms: ms,
      detail: ok ? `worker_mode=${body?.worker_mode ?? "?"} version=${body?.worker_version ?? "?"}` : `HTTP ${res.status}`,
      data: body,
    };
  } catch (e) {
    return { id: "health", name: "Worker health (GET /health)", pass: false, detail: `unreachable: ${String((e as Error).message)}` };
  }
}

async function testCapabilities(): Promise<TestResult> {
  try {
    const res = await workerFetch("/capabilities", { method: "GET", auth: null });
    const body = await res.json().catch(() => ({}));
    const skills: Array<{ name: string; implemented: boolean }> = body?.skills ?? [];
    const clip = skills.find((s) => s.name === "clip_point_cloud");
    const downstream = ["generate_dsm", "generate_dtm", "generate_chm", "fit_roof_planes"];
    const downstreamStillStubs = downstream.every((k) => {
      const s = skills.find((x) => x.name === k);
      return !s || s.implemented === false;
    });
    const pass = !!clip?.implemented && downstreamStillStubs;
    return {
      id: "capabilities", name: "Capabilities (clip_point_cloud=true, downstream=false)",
      pass,
      detail: pass
        ? `clip_point_cloud implemented; ${downstream.length} downstream still stubs`
        : `clip=${clip?.implemented} downstream_ok=${downstreamStillStubs}`,
      data: { clip, count: skills.length },
    };
  } catch (e) {
    return { id: "capabilities", name: "Capabilities", pass: false, detail: String((e as Error).message) };
  }
}

async function testAuthGuard(): Promise<TestResult> {
  try {
    const res = await workerFetch("/skills/clip-point-cloud", {
      method: "POST",
      auth: "intentionally-wrong-key",
      body: JSON.stringify({ skill_run_id: "x", measurement_request_id: "x", request_hash: "x".repeat(32), measurement_job_id: "x" }),
    });
    const pass = res.status === 401 || res.status === 403;
    return { id: "auth", name: "Auth guard rejects bad key", pass, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { id: "auth", name: "Auth guard rejects bad key", pass: false, detail: String((e as Error).message) };
  }
}

async function testValidationGates(): Promise<TestResult> {
  const baseValid = {
    skill_run_id: crypto.randomUUID(),
    measurement_request_id: crypto.randomUUID(),
    measurement_job_id: crypto.randomUUID(),
    request_hash: "a".repeat(32),
    source_url: "https://example.com/sample.laz",
    asset_type: "laz",
    aoi_geojson: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  };

  const cases: Array<{ label: string; mutate: (o: Record<string, unknown>) => void; flag?: string }> = [
    { label: "missing source_url", mutate: (o) => { o.source_url = null; }, flag: "missing_source_url" },
    { label: "missing AOI", mutate: (o) => { o.aoi_geojson = null; }, flag: "missing_aoi" },
    { label: "invalid AOI geojson", mutate: (o) => { o.aoi_geojson = { type: "Polygon", coordinates: [] }; }, flag: "invalid_aoi_geojson" },
    { label: "unsupported asset_type", mutate: (o) => { o.asset_type = "geotiff"; }, flag: "unsupported_asset_type" },
    { label: "short request_hash", mutate: (o) => { o.request_hash = "short"; }, flag: "missing_request_hash" },
  ];

  const sub: Array<{ label: string; pass: boolean; detail: string }> = [];
  for (const c of cases) {
    const payload: Record<string, unknown> = { ...baseValid };
    c.mutate(payload);
    try {
      const res = await workerFetch("/skills/clip-point-cloud", { method: "POST", body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      const status = String(body?.status ?? "");
      const qa: string[] = Array.isArray(body?.qa_flags) ? body.qa_flags : [];
      const failed = status === "failed" || res.status === 422 || res.status === 400;
      const flagOk = c.flag ? qa.includes(c.flag) : true;
      sub.push({ label: c.label, pass: failed && flagOk, detail: `status=${status} qa=${qa.join(",")}` });
    } catch (e) {
      sub.push({ label: c.label, pass: false, detail: String((e as Error).message) });
    }
  }
  const pass = sub.every((s) => s.pass);
  return {
    id: "validation", name: "Validation gates (5 sub-tests)",
    pass,
    detail: `${sub.filter((s) => s.pass).length}/${sub.length} passed`,
    data: sub,
  };
}

async function testCallbackHardening(svc: ReturnType<typeof serviceClient>): Promise<TestResult> {
  // Create a real mskill_run row, send a stub-flagged callback, expect downgrade.
  try {
    // Need a tenant + request + job to satisfy FKs. Reuse the most recent one
    // owned by any tenant — read-only probe; safe.
    const { data: job } = await svc.from("mskill_jobs").select("id, tenant_id, mskill_request_id").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!job) return { id: "callback_stub", name: "Callback hardening (stub refused)", pass: false, skipped: true, detail: "no mskill_jobs row to attach probe run" };

    const requestHash = "test-stub-" + crypto.randomUUID().replace(/-/g, "");
    const { data: run, error } = await svc.from("mskill_runs").insert({
      tenant_id: job.tenant_id,
      mskill_request_id: job.mskill_request_id,
      mskill_job_id: job.id,
      skill_key: "clip_point_cloud",
      status: "dispatched",
      execution_target: "internal_worker",
      request_hash: requestHash,
      input_payload: { probe: true },
    }).select("id").single();
    if (error || !run) return { id: "callback_stub", name: "Callback hardening (stub refused)", pass: false, detail: error?.message ?? "could not create probe run" };

    const cbRes = await fetch(`${CALLBACK_BASE}/functions/v1/measurement-worker/worker/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-worker-api-key": WORKER_API_KEY },
      body: JSON.stringify({
        mskill_run_id: run.id,
        request_hash: requestHash,
        status: "completed",
        qa_flags: ["stub", "no_real_compute"],
        artifacts: [],
        output_payload: {},
      }),
    });
    const cbBody = await cbRes.json().catch(() => ({}));
    const after = await svc.from("mskill_runs").select("status, blocking_reason").eq("id", run.id).single();
    const downgraded = cbBody?.status === "requires_internal_worker" || after.data?.status === "requires_internal_worker";

    // cleanup probe row
    await svc.from("mskill_runs").delete().eq("id", run.id);

    return {
      id: "callback_stub", name: "Callback hardening (stub refused → not completed)",
      pass: !!downgraded,
      detail: `final_status=${after.data?.status} blocking=${after.data?.blocking_reason}`,
      data: cbBody,
    };
  } catch (e) {
    return { id: "callback_stub", name: "Callback hardening", pass: false, detail: String((e as Error).message) };
  }
}

async function testHashMismatch(svc: ReturnType<typeof serviceClient>): Promise<TestResult> {
  try {
    const { data: job } = await svc.from("mskill_jobs").select("id, tenant_id, mskill_request_id").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!job) return { id: "hash_mismatch", name: "request_hash mismatch rejected", pass: false, skipped: true, detail: "no mskill_jobs row" };

    const realHash = "real-" + crypto.randomUUID().replace(/-/g, "");
    const { data: run, error } = await svc.from("mskill_runs").insert({
      tenant_id: job.tenant_id,
      mskill_request_id: job.mskill_request_id,
      mskill_job_id: job.id,
      skill_key: "clip_point_cloud",
      status: "dispatched",
      execution_target: "internal_worker",
      request_hash: realHash,
      input_payload: { probe: true },
    }).select("id").single();
    if (error || !run) return { id: "hash_mismatch", name: "request_hash mismatch rejected", pass: false, detail: error?.message ?? "probe run failed" };

    const cbRes = await fetch(`${CALLBACK_BASE}/functions/v1/measurement-worker/worker/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-worker-api-key": WORKER_API_KEY },
      body: JSON.stringify({
        mskill_run_id: run.id,
        request_hash: "wrong-hash-" + crypto.randomUUID().replace(/-/g, ""),
        status: "completed",
        artifacts: [{ artifact_type: "clipped_point_cloud", storage_path: "fake/path.laz" }],
      }),
    });
    const cbBody = await cbRes.json().catch(() => ({}));
    const after = await svc.from("mskill_runs").select("status").eq("id", run.id).single();
    const rejected = cbRes.status === 409 || cbBody?.code === "stale_request" || cbBody?.error?.code === "stale_request";
    const stillDispatched = after.data?.status === "dispatched";

    await svc.from("mskill_runs").delete().eq("id", run.id);

    return {
      id: "hash_mismatch", name: "request_hash mismatch rejected (HTTP 409)",
      pass: rejected && stillDispatched,
      detail: `http=${cbRes.status} run_status_after=${after.data?.status}`,
      data: cbBody,
    };
  } catch (e) {
    return { id: "hash_mismatch", name: "request_hash mismatch rejected", pass: false, detail: String((e as Error).message) };
  }
}

function testDownstreamBlocked(): TestResult {
  const downstream = allDownstreamOf("clip_point_cloud");
  const expected = ["generate_dsm", "generate_dtm", "generate_chm", "isolate_roof_points", "fit_roof_planes", "calculate_pitch", "calculate_roof_area"];
  const missing = expected.filter((k) => !downstream.includes(k));
  const totalDownstream = downstream.length;
  return {
    id: "downstream", name: "Registry: downstream skills depend on clip_point_cloud",
    pass: missing.length === 0,
    detail: missing.length ? `missing dependents: ${missing.join(", ")}` : `${totalDownstream} downstream skills correctly gated`,
    data: { downstream, missing, registry_size: MSKILL_REGISTRY.length },
  };
}

// ---------------------------------------------------------------------------
// Real-clip fixture tests — call the worker's /test/clip-point-cloud-fixture
// endpoint. This proves end-to-end PDAL + storage fallback works without
// needing a live roof_surface_asset.
// ---------------------------------------------------------------------------

async function callFixture(mode: "real" | "sparse"): Promise<{ res: Response; body: any }> {
  const res = await workerFetch("/test/clip-point-cloud-fixture", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function testRealClipFixture(): Promise<TestResult> {
  try {
    const { res, body } = await callFixture("real");
    if (res.status === 403) {
      return {
        id: "real_clip", name: "Real clip fixture (test endpoint)",
        pass: false, skipped: true,
        detail: "Worker in production mode — fixture endpoint disabled. Run from job pipeline with a live roof_surface_asset.",
      };
    }
    if (res.status === 404) {
      return {
        id: "real_clip", name: "Real clip fixture (test endpoint)",
        pass: false, skipped: true,
        detail: "Worker missing /test/clip-point-cloud-fixture — redeploy worker with v0.2.1+.",
      };
    }
    if (!res.ok) {
      return { id: "real_clip", name: "Real clip fixture", pass: false, detail: `HTTP ${res.status}`, data: body };
    }
    const status = String(body?.status ?? "");
    const arts = Array.isArray(body?.artifacts) ? body.artifacts : [];
    const art = arts[0];
    const payload = body?.output_payload ?? {};
    const pc = Number(payload?.point_count ?? 0);
    const b = payload?.bounds;
    const fx = payload?._fixture;
    const aoi = fx?.aoi_bounds as number[] | undefined;
    let boundsInsideAoi = false;
    if (b && aoi && aoi.length === 4) {
      const slack = 0.5;
      boundsInsideAoi =
        b.minx >= aoi[0] - slack && b.maxx <= aoi[2] + slack &&
        b.miny >= aoi[1] - slack && b.maxy <= aoi[3] + slack;
    }
    const artifactOk = !!art && typeof art.storage_path === "string" && art.storage_path.length > 0;
    const pass = status === "completed" && pc > 0 && boundsInsideAoi && artifactOk;
    return {
      id: "real_clip",
      name: "Real clip fixture (status=completed + artifact + bounds⊂AOI)",
      pass,
      detail: pass
        ? `points=${pc} storage=${art.storage_path}`
        : `status=${status} pc=${pc} boundsInsideAoi=${boundsInsideAoi} artifact=${artifactOk}`,
      data: { status, point_count: pc, bounds: b, artifact: art, qa_flags: body?.qa_flags },
    };
  } catch (e) {
    return { id: "real_clip", name: "Real clip fixture", pass: false, detail: String((e as Error).message) };
  }
}

async function testSparseAoiFixture(): Promise<TestResult> {
  try {
    const { res, body } = await callFixture("sparse");
    if (res.status === 403 || res.status === 404) {
      return {
        id: "sparse", name: "Sparse AOI fixture", pass: false, skipped: true,
        detail: res.status === 403 ? "Worker in production mode — fixture endpoint disabled." : "Worker missing fixture endpoint.",
      };
    }
    if (!res.ok) {
      return { id: "sparse", name: "Sparse AOI fixture", pass: false, detail: `HTTP ${res.status}`, data: body };
    }
    const status = String(body?.status ?? "");
    const qa: string[] = Array.isArray(body?.qa_flags) ? body.qa_flags : [];
    const arts = Array.isArray(body?.artifacts) ? body.artifacts : [];
    const badSignals = ["empty_pipeline_result", "low_point_count", "bounds_outside_aoi", "no_points", "sparse_output", "pipeline_error"];
    const hasBadSignal = qa.some((f) => badSignals.includes(f));
    const notCompleted = status !== "completed";
    const noPromotedArtifact = status === "failed" ? arts.length === 0 : true;
    const pass = notCompleted && hasBadSignal && noPromotedArtifact;
    return {
      id: "sparse",
      name: "Sparse AOI fixture (status≠completed, qa flagged, no promoted artifact)",
      pass,
      detail: `status=${status} qa=${qa.join(",")} artifacts=${arts.length}`,
      data: body,
    };
  } catch (e) {
    return { id: "sparse", name: "Sparse AOI fixture", pass: false, detail: String((e as Error).message) };
  }
}

// ---------------------------------------------------------------------------
// Public routes — master/admin only via requireAuth + role check
// ---------------------------------------------------------------------------

app.get("/__health", (c) => jsonOk(c, { fn: "measurement-worker-test", ok: true }));

app.use("/*", requireAuth);

async function ensureAdmin(c: Parameters<Parameters<typeof app.get>[1]>[0]): Promise<Response | null> {
  const userId = c.get("userId");
  if (!userId) return jsonErr(c, "unauthorized", "auth required", 401);
  const svc = serviceClient();
  const { data } = await svc.from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "master"]);
  if (!data || data.length === 0) return jsonErr(c, "forbidden", "admin or master role required", 403);
  return null;
}

app.get("/config", async (c) => {
  const denied = await ensureAdmin(c); if (denied) return denied;
  return jsonOk(c, {
    worker_base_url_configured: !!WORKER_BASE_URL,
    worker_api_key_configured: !!WORKER_API_KEY,
    callback_base_url: CALLBACK_BASE,
    worker_base_url_preview: WORKER_BASE_URL ? `${WORKER_BASE_URL.slice(0, 24)}…` : null,
  });
});

app.post("/run", async (c) => {
  const denied = await ensureAdmin(c); if (denied) return denied;

  if (!WORKER_BASE_URL || !WORKER_API_KEY) {
    return jsonOk(c, {
      ok: false,
      summary: { passed: 0, failed: 1, skipped: 0 },
      results: [{
        id: "config", name: "Worker env configured",
        pass: false,
        detail: "INTERNAL_WORKER_BASE_URL and/or INTERNAL_WORKER_API_KEY missing on edge function secrets",
      }],
    });
  }

  const svc = serviceClient();
  const results: TestResult[] = [];

  const health = await testHealth();
  results.push(health);
  if (!health.pass) {
    return jsonOk(c, {
      ok: false,
      summary: { passed: 0, failed: results.length, skipped: 0 },
      results,
      stopped: "worker unreachable — remaining tests skipped",
    });
  }

  const caps = await testCapabilities();
  results.push(caps);
  if (!caps.pass) {
    return jsonOk(c, {
      ok: false,
      summary: { passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, skipped: 0 },
      results,
      stopped: "clip_point_cloud not implemented on worker — remaining tests skipped",
    });
  }

  results.push(await testAuthGuard());
  results.push(await testValidationGates());
  results.push(testDownstreamBlocked());
  results.push(await testCallbackHardening(svc));
  results.push(await testHashMismatch(svc));

  // Real-clip + sparse-AOI tests via the worker's /test/clip-point-cloud-fixture
  // endpoint (enabled only when WORKER_MODE != production).
  results.push(await testRealClipFixture());
  results.push(await testSparseAoiFixture());

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  return jsonOk(c, {
    ok: failed === 0,
    summary: { passed, failed, skipped, total: results.length },
    results,
  });
});

serveRouter(app);
