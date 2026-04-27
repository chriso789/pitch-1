// Phase 6: Continuous Learning Loop
//
// Aggregates accuracy signals (vendor truth, manager/field corrections, gate
// decisions) into measurement_learning_events and rolls them up into daily
// measurement_accuracy_snapshots so we can track model improvement over time.
//
// Actions:
//   record_event   → insert a learning event
//   snapshot_today → compute today's accuracy snapshot per tenant
//   metrics        → return rolling accuracy metrics for the dashboard

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function avg(vals: (number | null | undefined)[]): number | null {
  const xs = vals.filter((v): v is number => typeof v === "number" && !isNaN(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function recordEvent(body: any) {
  const insert = {
    measurement_id: body.measurement_id ?? null,
    tenant_id: body.tenant_id ?? null,
    event_type: body.event_type,
    source: body.source ?? null,
    gate_decision: body.gate_decision ?? null,
    per_class_errors: body.per_class_errors ?? null,
    area_error_pct: body.area_error_pct ?? null,
    pitch_error_deg: body.pitch_error_deg ?? null,
    ridge_error_pct: body.ridge_error_pct ?? null,
    hip_error_pct: body.hip_error_pct ?? null,
    valley_error_pct: body.valley_error_pct ?? null,
    eave_error_pct: body.eave_error_pct ?? null,
    rake_error_pct: body.rake_error_pct ?? null,
    weighted_score: body.weighted_score ?? null,
    payload: body.payload ?? null,
  };
  const { data, error } = await sb
    .from("measurement_learning_events")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function snapshotToday(tenant_id?: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const since = `${today}T00:00:00Z`;

  let q = sb
    .from("measurement_learning_events")
    .select("*")
    .gte("created_at", since);
  if (tenant_id) q = q.eq("tenant_id", tenant_id);

  const { data: events, error } = await q;
  if (error) throw error;

  // Group by tenant
  const byTenant = new Map<string, any[]>();
  for (const e of events ?? []) {
    const key = e.tenant_id ?? "__null__";
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key)!.push(e);
  }

  const snapshots: any[] = [];
  for (const [tid, evs] of byTenant) {
    const total = evs.length;
    const auto = evs.filter((e) => e.gate_decision === "auto_ship").length;
    const review = evs.filter((e) => e.gate_decision === "review_required").length;
    const reject = evs.filter((e) => e.gate_decision === "reject").length;

    const passRate = (key: string) => {
      const withErr = evs.filter((e) => typeof e[key] === "number");
      if (withErr.length === 0) return null;
      const passed = withErr.filter((e) =>
        key === "pitch_error_deg" ? e[key] <= 1 : e[key] <= 3
      ).length;
      return passed / withErr.length;
    };

    const snap = {
      tenant_id: tid === "__null__" ? null : tid,
      snapshot_date: today,
      total_measurements: total,
      auto_ship_count: auto,
      review_required_count: review,
      reject_count: reject,
      auto_ship_rate: total > 0 ? auto / total : null,
      avg_area_error_pct: avg(evs.map((e) => e.area_error_pct)),
      avg_pitch_error_deg: avg(evs.map((e) => e.pitch_error_deg)),
      avg_ridge_error_pct: avg(evs.map((e) => e.ridge_error_pct)),
      avg_eave_error_pct: avg(evs.map((e) => e.eave_error_pct)),
      per_class_pass_rates: {
        area: passRate("area_error_pct"),
        pitch: passRate("pitch_error_deg"),
        ridge: passRate("ridge_error_pct"),
        hip: passRate("hip_error_pct"),
        valley: passRate("valley_error_pct"),
        eave: passRate("eave_error_pct"),
        rake: passRate("rake_error_pct"),
      },
      algorithm_version: "phase-6-v1",
    };

    const { data, error: upErr } = await sb
      .from("measurement_accuracy_snapshots")
      .upsert(snap, {
        onConflict: "tenant_id,snapshot_date,algorithm_version",
      })
      .select()
      .single();
    if (upErr) throw upErr;
    snapshots.push(data);
  }

  return { count: snapshots.length, snapshots };
}

async function metrics(body: any) {
  const days = Number(body.days ?? 30);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  let q = sb
    .from("measurement_accuracy_snapshots")
    .select("*")
    .gte("snapshot_date", since.slice(0, 10))
    .order("snapshot_date", { ascending: true });
  if (body.tenant_id) q = q.eq("tenant_id", body.tenant_id);
  const { data, error } = await q;
  if (error) throw error;

  const totals = (data ?? []).reduce(
    (acc, r) => {
      acc.total += r.total_measurements ?? 0;
      acc.auto += r.auto_ship_count ?? 0;
      acc.review += r.review_required_count ?? 0;
      acc.reject += r.reject_count ?? 0;
      return acc;
    },
    { total: 0, auto: 0, review: 0, reject: 0 },
  );

  return {
    window_days: days,
    snapshots: data ?? [],
    totals,
    auto_ship_rate: totals.total > 0 ? totals.auto / totals.total : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action ?? "metrics";

    let result: any;
    if (action === "record_event") result = await recordEvent(body);
    else if (action === "snapshot_today") result = await snapshotToday(body.tenant_id);
    else if (action === "metrics") result = await metrics(body);
    else throw new Error(`Unknown action: ${action}`);

    return new Response(JSON.stringify({ ok: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
