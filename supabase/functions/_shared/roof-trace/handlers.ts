// RoofTrace AI — perimeter-first tracing workflow handlers.
// Called from measurement-api routes. All logic tenant-scoped; service role
// clients apply explicit tenant_id filters.

import { createClient } from "npm:@supabase/supabase-js@2";

type Ctx = {
  tenantId: string;
  userId: string;
  requestId: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function svc() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------- geometry helpers ----------

type Pt = [number, number];

function polygonAreaPx(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function polygonPerimeterPx(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const ccw = (p: Pt, q: Pt, r: Pt) =>
    (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function polygonSelfIntersects(pts: Pt[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent wrap
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function computeGateMetrics(pts: Pt[], imageWidth: number, imageHeight: number) {
  const closed = pts.length >= 3;
  const selfIntersects = polygonSelfIntersects(pts);
  const areaPx = polygonAreaPx(pts);
  const perimeterPx = polygonPerimeterPx(pts);
  const frameArea = Math.max(1, imageWidth * imageHeight);
  const coverage = areaPx / frameArea; // fraction of tile covered
  return {
    closed,
    self_intersects: selfIntersects,
    area_px: Math.round(areaPx),
    perimeter_px: Math.round(perimeterPx),
    coverage_pct: Math.round(coverage * 10000) / 100,
    passes: closed && !selfIntersects && coverage > 0.05 && coverage < 0.9,
  };
}

// ---------- vision-trace invocation ----------

async function invokeVisionTrace(payload: Record<string, unknown>): Promise<any> {
  const url = `${SUPABASE_URL}/functions/v1/vision-trace-roof`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: SERVICE_ROLE,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  if (!res.ok) {
    throw new Error(`vision-trace-roof failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return json ?? {};
}

// ---------- public handler contract ----------

export type CreateSessionInput = {
  address?: string;
  lat?: number;
  lng?: number;
  job_id?: string | null;
};

export async function createSession(ctx: Ctx, input: CreateSessionInput) {
  const s = svc();
  const { data, error } = await s
    .from("roof_trace_sessions")
    .insert({
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
      address: input.address ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      job_id: input.job_id ?? null,
      source: {
        kind: "google_satellite",
        captured_via: "vision-trace-roof",
      },
      result_state: "queued",
      perimeter_status: "pending",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getSession(ctx: Ctx, sessionId: string) {
  const s = svc();
  const [{ data: session }, { data: revisions }, { data: jobs }] = await Promise.all([
    s.from("roof_trace_sessions").select("*").eq("id", sessionId).eq("tenant_id", ctx.tenantId).maybeSingle(),
    s.from("roof_trace_revisions").select("*").eq("session_id", sessionId).eq("tenant_id", ctx.tenantId).order("revision", { ascending: false }),
    s.from("roof_trace_jobs").select("*").eq("session_id", sessionId).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }),
  ]);
  if (!session) throw new Error("session_not_found");
  return { session, revisions: revisions ?? [], jobs: jobs ?? [] };
}

export async function runPerimeter(ctx: Ctx, sessionId: string) {
  const s = svc();
  const { data: session, error: sErr } = await s
    .from("roof_trace_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!session) throw new Error("session_not_found");
  if (session.lat == null || session.lng == null) {
    throw new Error("session_missing_coordinates");
  }

  // Insert a perimeter job row (queued -> running)
  const { data: job, error: jErr } = await s
    .from("roof_trace_jobs")
    .insert({
      tenant_id: ctx.tenantId,
      session_id: sessionId,
      type: "perimeter",
      status: "running",
      input: { lat: session.lat, lng: session.lng, address: session.address },
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (jErr) throw new Error(jErr.message);

  await s.from("roof_trace_sessions").update({
    result_state: "tracing_perimeter",
  }).eq("id", sessionId).eq("tenant_id", ctx.tenantId);

  try {
    const trace = await invokeVisionTrace({
      address: session.address ?? "",
      lat: session.lat,
      lng: session.lng,
      autoRun: true,
    });

    // vision-trace-roof returns { segments, imageUrl, imageWidth, imageHeight, ... }
    const segments: any[] = Array.isArray(trace?.segments) ? trace.segments : [];
    const imageWidth = Number(trace?.imageWidth ?? trace?.width ?? 640);
    const imageHeight = Number(trace?.imageHeight ?? trace?.height ?? 640);

    // Derive an outer perimeter polygon from segments classified as eave/rake/perimeter,
    // falling back to the convex hull of all segment endpoints.
    const outerPts: Pt[] = extractOuterPerimeter(segments);
    const gate = computeGateMetrics(outerPts, imageWidth, imageHeight);

    const nextRevision = (session.current_revision ?? 0) + 1;

    const { data: rev, error: rErr } = await s
      .from("roof_trace_revisions")
      .insert({
        tenant_id: ctx.tenantId,
        session_id: sessionId,
        revision: nextRevision,
        state: "draft",
        author_id: ctx.userId,
        geometry: {
          coordinate_space: "image_px",
          image_width: imageWidth,
          image_height: imageHeight,
          outer_perimeter: outerPts,
          segments,
          image_url: trace?.imageUrl ?? trace?.tileUrl ?? null,
          image_bounds: trace?.imageBounds ?? null,
          zoom: trace?.zoom ?? null,
        },
        perimeter_gate_metrics: gate,
        warnings: gate.passes ? [] : [{ code: "perimeter_gate_failed", detail: gate }],
      })
      .select("*")
      .single();
    if (rErr) throw new Error(rErr.message);

    await s.from("roof_trace_sessions").update({
      current_revision: nextRevision,
      perimeter_status: gate.passes ? "proposed" : "needs_review",
      result_state: gate.passes ? "needs_review" : "needs_review",
    }).eq("id", sessionId).eq("tenant_id", ctx.tenantId);

    await s.from("roof_trace_jobs").update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      output: { revision_id: rev.id, revision: nextRevision, gate_metrics: gate },
    }).eq("id", job.id);

    return { session_id: sessionId, revision: rev, gate_metrics: gate };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await s.from("roof_trace_jobs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: msg,
    }).eq("id", job.id);
    await s.from("roof_trace_sessions").update({ result_state: "failed" })
      .eq("id", sessionId).eq("tenant_id", ctx.tenantId);
    throw e;
  }
}

export async function approveSession(ctx: Ctx, sessionId: string) {
  const s = svc();
  const { data: session } = await s.from("roof_trace_sessions").select("*")
    .eq("id", sessionId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!session) throw new Error("session_not_found");

  const { data: rev } = await s.from("roof_trace_revisions").select("*")
    .eq("session_id", sessionId).eq("tenant_id", ctx.tenantId)
    .order("revision", { ascending: false }).limit(1).maybeSingle();
  if (!rev) throw new Error("no_revision_to_approve");

  const gate = (rev as any).perimeter_gate_metrics ?? {};
  if (!gate.passes) {
    throw new Error("perimeter_gate_not_passed");
  }

  // Mark prior approved as superseded (defensive), then approve this one.
  await s.from("roof_trace_revisions").update({ state: "superseded" })
    .eq("session_id", sessionId).eq("state", "approved").eq("tenant_id", ctx.tenantId);

  const now = new Date().toISOString();
  const { error: uErr } = await s.from("roof_trace_revisions").update({
    state: "approved",
    approved_by: ctx.userId,
    approved_at: now,
  }).eq("id", rev.id).eq("tenant_id", ctx.tenantId);
  if (uErr) throw new Error(uErr.message);

  await s.from("roof_trace_sessions").update({
    approved_revision: rev.revision,
    perimeter_status: "accepted",
    result_state: "ready",
  }).eq("id", sessionId).eq("tenant_id", ctx.tenantId);

  // Create measurement draft (perimeter-only for this MVP).
  const { data: draft, error: dErr } = await s.from("measurement_drafts").insert({
    tenant_id: ctx.tenantId,
    session_id: sessionId,
    revision_id: rev.id,
    job_id: session.job_id,
    status: "ready",
    approved_by: ctx.userId,
    totals: {
      perimeter_px: gate.perimeter_px ?? null,
      area_px: gate.area_px ?? null,
    },
    linear_totals: {},
    facets: [],
    warnings: [],
  }).select("*").single();
  if (dErr) throw new Error(dErr.message);

  return { revision: rev, measurement_draft: draft };
}

// ---------- perimeter extraction ----------

function extractOuterPerimeter(segments: any[]): Pt[] {
  const eaveKinds = new Set(["eave", "rake", "perimeter", "outer"]);
  const pts: Pt[] = [];
  for (const seg of segments) {
    const kind = String(seg?.kind ?? seg?.type ?? "").toLowerCase();
    if (!eaveKinds.has(kind)) continue;
    const a = seg?.a ?? seg?.start ?? seg?.from;
    const b = seg?.b ?? seg?.end ?? seg?.to;
    if (Array.isArray(a) && a.length >= 2) pts.push([Number(a[0]), Number(a[1])]);
    if (Array.isArray(b) && b.length >= 2) pts.push([Number(b[0]), Number(b[1])]);
  }
  // Fallback: use all endpoints
  if (pts.length < 3) {
    for (const seg of segments) {
      const a = seg?.a ?? seg?.start ?? seg?.from;
      const b = seg?.b ?? seg?.end ?? seg?.to;
      if (Array.isArray(a) && a.length >= 2) pts.push([Number(a[0]), Number(a[1])]);
      if (Array.isArray(b) && b.length >= 2) pts.push([Number(b[0]), Number(b[1])]);
    }
  }
  if (pts.length < 3) return [];
  return convexHull(pts);
}

function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
