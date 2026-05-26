// platform-api — platform-admin (master role) only. Owns infra cost tracking,
// usage limit checks, and developer cost-dashboard endpoints.
//
// Routes:
//   POST /track-usage             internal-secret OR master  → insert usage_events row
//   POST /check-usage-limit       authenticated              → boolean gate for hot paths
//   POST /recalculate-rollups     internal-secret OR master  → upsert monthly rollups
//   GET  /dashboard               master                     → MTD totals + per-provider spend
//   GET  /companies               master                     → company table rows w/ status
//   GET  /company-detail          master  ?tenant_id=...     → drilldown
//   GET  /user-detail             master  ?user_id=...       → drilldown
//   GET  /provider-costs          master                     → list pricing
//   POST /provider-costs/update   master                     → edit pricing row
//   POST /seed-test-event         master                     → developer test buttons

import { createRouter, jsonOk, jsonErr, requireAuth, serviceClient, type RouterEnv } from "../_shared/router.ts";
import { requireInternalSecret } from "../_shared/auth.ts";
import type { Context, Next } from "jsr:@hono/hono";

const app = createRouter("platform-api");

app.get("/__health", (c) => jsonOk(c, { fn: "platform-api", ok: true }));

// Master-only: report whether INTERNAL_WORKER_SECRET is configured.
// Never returns the value itself.
app.get("/internal-secret-status", requireAuth, requireMaster, (c) => {
  const configured = Boolean(Deno.env.get("INTERNAL_WORKER_SECRET"));
  return jsonOk(c, { configured });
});

// ---- master role gate ----
async function requireMaster(c: Context<RouterEnv>, next: Next) {
  const userId = c.get("userId");
  if (!userId) return jsonErr(c, "unauthorized", "auth required", 401);
  const svc = serviceClient();
  const { data } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "master")
    .maybeSingle();
  if (!data) return jsonErr(c, "forbidden", "platform admin required", 403);
  await next();
}

// Accept either internal worker secret OR a master-authenticated session.
async function requireInternalOrMaster(c: Context<RouterEnv>, next: Next) {
  if (c.req.header("x-internal-secret")) return requireInternalSecret(c, next);
  return requireAuth(c, async () => requireMaster(c, next));
}

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ============================================================
// /track-usage
// ============================================================
app.post("/track-usage", requireInternalOrMaster, async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "bad_json", "invalid body", 400); }

  const {
    tenant_id = null,
    company_id = null, // accept alias
    user_id = null,
    provider,
    event_type,
    feature_area = null,
    quantity = 1,
    unit = null,
    request_id = null,
    edge_function = null,
    status = "success",
    metadata = {},
  } = body ?? {};

  if (!provider || !event_type) {
    return jsonErr(c, "validation", "provider and event_type required", 400);
  }

  const tid = tenant_id ?? company_id;
  const qty = Number(quantity) || 0;
  const svc = serviceClient();

  // Server-side cost calc only.
  const { data: cost } = await svc
    .from("provider_costs")
    .select("cost_per_unit, markup_percent, unit, is_active")
    .eq("provider", provider)
    .eq("event_type", event_type)
    .maybeSingle();

  const unitCost = cost?.is_active ? Number(cost.cost_per_unit) : 0;
  const markup = cost ? Number(cost.markup_percent || 0) : 0;
  const estimatedCost = unitCost * qty;
  const billableAmount = estimatedCost * (1 + markup / 100);
  const resolvedUnit = unit ?? cost?.unit ?? null;

  const { data: inserted, error } = await svc
    .from("usage_events")
    .insert({
      tenant_id: tid,
      user_id,
      provider,
      event_type,
      feature_area,
      quantity: qty,
      unit: resolvedUnit,
      unit_cost: unitCost,
      estimated_cost: estimatedCost,
      billable_amount: billableAmount,
      request_id,
      edge_function,
      status,
      metadata: metadata ?? {},
    })
    .select()
    .single();

  if (error) return jsonErr(c, "insert_failed", error.message, 500);
  return jsonOk(c, inserted);
});

// ============================================================
// /check-usage-limit
// ============================================================
app.post("/check-usage-limit", requireInternalOrMaster, async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "bad_json", "invalid body", 400); }
  const { tenant_id, company_id, event_type, quantity = 1 } = body ?? {};
  const tid = tenant_id ?? company_id;
  if (!tid || !event_type) return jsonErr(c, "validation", "tenant_id and event_type required", 400);

  const svc = serviceClient();
  const { data: limits } = await svc
    .from("company_usage_limits")
    .select("*")
    .eq("tenant_id", tid)
    .maybeSingle();

  if (!limits) {
    return jsonOk(c, { allowed: true, current_usage: 0, limit: null, percent_used: 0, warning: false, reason: "no_plan_configured" });
  }

  const limitMap: Record<string, { col: string; aggregator: "count" | "sum_qty" }> = {
    sms_outbound: { col: "sms_monthly_limit", aggregator: "count" },
    sms_inbound: { col: "sms_monthly_limit", aggregator: "count" },
    ai_prompt: { col: "ai_prompt_monthly_limit", aggregator: "count" },
    ai_generation: { col: "ai_prompt_monthly_limit", aggregator: "count" },
    ai_tokens_input: { col: "ai_token_monthly_limit", aggregator: "sum_qty" },
    ai_tokens_output: { col: "ai_token_monthly_limit", aggregator: "sum_qty" },
    storage_mb: { col: "storage_mb_limit", aggregator: "sum_qty" },
    map_load: { col: "map_load_monthly_limit", aggregator: "count" },
    scrape_credit: { col: "scrape_monthly_limit", aggregator: "count" },
    roof_report: { col: "roof_report_monthly_limit", aggregator: "count" },
    voice_minute: { col: "voice_minute_monthly_limit", aggregator: "sum_qty" },
  };
  const cfg = limitMap[event_type];
  if (!cfg) return jsonOk(c, { allowed: true, current_usage: 0, limit: null, percent_used: 0, warning: false, reason: "untracked_event" });

  const limit = Number((limits as any)[cfg.col] ?? 0);

  // Sum quantities (or count rows) for the current month.
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  let current = 0;
  if (cfg.aggregator === "sum_qty") {
    const { data } = await svc
      .from("usage_events")
      .select("quantity")
      .eq("tenant_id", tid)
      .eq("event_type", event_type)
      .gte("created_at", monthStart.toISOString());
    current = (data ?? []).reduce((s, r: any) => s + Number(r.quantity || 0), 0);
  } else {
    const { count } = await svc
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .eq("event_type", event_type)
      .gte("created_at", monthStart.toISOString());
    current = count ?? 0;
  }

  const projected = current + Number(quantity || 0);
  const percent = limit > 0 ? Math.round((projected / limit) * 100) : 0;
  const warning = limit > 0 && percent >= (limits.warning_threshold_percent ?? 80);
  const exceeded = limit > 0 && projected > limit;
  const allowed = !(exceeded && limits.hard_stop_enabled);

  return jsonOk(c, {
    allowed,
    current_usage: current,
    limit,
    percent_used: percent,
    warning,
    reason: allowed ? (warning ? "approaching_limit" : "ok") : "limit_exceeded",
  });
});

// ============================================================
// /recalculate-rollups
// ============================================================
app.post("/recalculate-rollups", requireInternalOrMaster, async (c) => {
  const svc = serviceClient();
  const month = monthKey();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const { data: events, error } = await svc
    .from("usage_events")
    .select("tenant_id,user_id,provider,event_type,quantity,estimated_cost")
    .gte("created_at", monthStart.toISOString());
  if (error) return jsonErr(c, "query_failed", error.message, 500);

  // Aggregate per tenant
  const tenantAgg = new Map<string, any>();
  const userAgg = new Map<string, any>();

  for (const e of events ?? []) {
    const tid = (e as any).tenant_id ?? "unknown";
    const uid = (e as any).user_id;
    const qty = Number((e as any).quantity || 0);
    const cost = Number((e as any).estimated_cost || 0);

    const t = tenantAgg.get(tid) ?? {
      total_estimated_cost: 0, event_count: 0,
      sms_count: 0, ai_prompt_count: 0, ai_token_count: 0,
      voice_minutes: 0, map_loads: 0, storage_mb: 0, scrape_count: 0, roof_report_count: 0,
      breakdown: {} as Record<string, number>,
    };
    t.total_estimated_cost += cost;
    t.event_count += 1;
    t.breakdown[(e as any).provider] = (t.breakdown[(e as any).provider] ?? 0) + cost;
    switch ((e as any).event_type) {
      case "sms_outbound": case "sms_inbound": t.sms_count += 1; break;
      case "ai_generation": case "ai_prompt": t.ai_prompt_count += 1; break;
      case "ai_tokens_input": case "ai_tokens_output": t.ai_token_count += qty; break;
      case "voice_minute": t.voice_minutes += qty; break;
      case "map_load": t.map_loads += 1; break;
      case "storage_mb": t.storage_mb += qty; break;
      case "scrape_credit": case "search": t.scrape_count += 1; break;
      case "roof_report": t.roof_report_count += 1; break;
    }
    tenantAgg.set(tid, t);

    if (uid) {
      const k = `${tid}::${uid}`;
      const u = userAgg.get(k) ?? {
        total_estimated_cost: 0, event_count: 0,
        sms_count: 0, ai_prompt_count: 0, ai_token_count: 0, voice_minutes: 0,
        breakdown: {} as Record<string, number>,
      };
      u.total_estimated_cost += cost;
      u.event_count += 1;
      u.breakdown[(e as any).provider] = (u.breakdown[(e as any).provider] ?? 0) + cost;
      switch ((e as any).event_type) {
        case "sms_outbound": case "sms_inbound": u.sms_count += 1; break;
        case "ai_generation": case "ai_prompt": u.ai_prompt_count += 1; break;
        case "ai_tokens_input": case "ai_tokens_output": u.ai_token_count += qty; break;
        case "voice_minute": u.voice_minutes += qty; break;
      }
      userAgg.set(k, u);
    }
  }

  // Pull plan revenue per tenant
  const tenantIds = [...tenantAgg.keys()].filter((x) => x && x !== "unknown");
  const { data: plans } = tenantIds.length
    ? await svc.from("company_usage_limits").select("tenant_id,monthly_price").in("tenant_id", tenantIds)
    : { data: [] as any[] };
  const priceByTenant = new Map<string, number>((plans ?? []).map((p: any) => [p.tenant_id, Number(p.monthly_price || 0)]));

  // Upsert tenant rollups
  const tenantRows = [...tenantAgg.entries()]
    .filter(([tid]) => tid && tid !== "unknown")
    .map(([tid, t]) => {
      const revenue = priceByTenant.get(tid) ?? 0;
      const gp = revenue - t.total_estimated_cost;
      const margin = revenue > 0 ? (gp / revenue) * 100 : 0;
      return {
        tenant_id: tid, month,
        revenue, total_estimated_cost: t.total_estimated_cost,
        gross_profit: gp, gross_margin_percent: margin,
        sms_count: t.sms_count, ai_prompt_count: t.ai_prompt_count, ai_token_count: t.ai_token_count,
        voice_minutes: t.voice_minutes, map_loads: t.map_loads, storage_mb: t.storage_mb,
        scrape_count: t.scrape_count, roof_report_count: t.roof_report_count,
        event_count: t.event_count, breakdown: t.breakdown,
      };
    });

  if (tenantRows.length) {
    const { error: upErr } = await svc.from("company_usage_monthly_rollups")
      .upsert(tenantRows, { onConflict: "tenant_id,month" });
    if (upErr) return jsonErr(c, "tenant_upsert_failed", upErr.message, 500);
  }

  // Upsert user rollups
  const userRows = [...userAgg.entries()].map(([k, u]) => {
    const [tid, uid] = k.split("::");
    return {
      tenant_id: tid === "unknown" ? null : tid, user_id: uid, month,
      total_estimated_cost: u.total_estimated_cost, event_count: u.event_count,
      sms_count: u.sms_count, ai_prompt_count: u.ai_prompt_count, ai_token_count: u.ai_token_count,
      voice_minutes: u.voice_minutes, breakdown: u.breakdown,
    };
  });
  if (userRows.length) {
    const { error: upErr } = await svc.from("user_usage_monthly_rollups")
      .upsert(userRows, { onConflict: "tenant_id,user_id,month" });
    if (upErr) return jsonErr(c, "user_upsert_failed", upErr.message, 500);
  }

  return jsonOk(c, { month, tenants: tenantRows.length, users: userRows.length });
});

// ============================================================
// Dashboard endpoints (master only)
// ============================================================
app.use("/dashboard", requireAuth, requireMaster);
app.use("/companies", requireAuth, requireMaster);
app.use("/company-detail", requireAuth, requireMaster);
app.use("/user-detail", requireAuth, requireMaster);
app.use("/provider-costs", requireAuth, requireMaster);
app.use("/provider-costs/update", requireAuth, requireMaster);
app.use("/seed-test-event", requireAuth, requireMaster);

app.get("/dashboard", async (c) => {
  const svc = serviceClient();
  const month = monthKey();
  const { data: rollups } = await svc
    .from("company_usage_monthly_rollups")
    .select("*")
    .eq("month", month);

  const totalRevenue = (rollups ?? []).reduce((s, r: any) => s + Number(r.revenue || 0), 0);
  const totalCost = (rollups ?? []).reduce((s, r: any) => s + Number(r.total_estimated_cost || 0), 0);

  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { data: events } = await svc
    .from("usage_events")
    .select("provider, estimated_cost, tenant_id, user_id")
    .gte("created_at", monthStart.toISOString());

  const byProvider: Record<string, number> = {};
  const byTenant: Record<string, number> = {};
  const byUser: Record<string, number> = {};
  for (const e of events ?? []) {
    const cost = Number((e as any).estimated_cost || 0);
    byProvider[(e as any).provider] = (byProvider[(e as any).provider] ?? 0) + cost;
    if ((e as any).tenant_id) byTenant[(e as any).tenant_id] = (byTenant[(e as any).tenant_id] ?? 0) + cost;
    if ((e as any).user_id) byUser[(e as any).user_id] = (byUser[(e as any).user_id] ?? 0) + cost;
  }

  const topTenantId = Object.entries(byTenant).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topUserId = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let topTenantName: string | null = null;
  if (topTenantId) {
    const { data } = await svc.from("tenants").select("name").eq("id", topTenantId).maybeSingle();
    topTenantName = (data as any)?.name ?? topTenantId;
  }

  return jsonOk(c, {
    month,
    revenue_mtd: totalRevenue,
    cost_mtd: totalCost,
    gross_profit: totalRevenue - totalCost,
    gross_margin_percent: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
    by_provider: byProvider,
    most_expensive_company: topTenantId ? { tenant_id: topTenantId, name: topTenantName, cost: byTenant[topTenantId] } : null,
    most_expensive_user: topUserId ? { user_id: topUserId, cost: byUser[topUserId] } : null,
  });
});

app.get("/companies", async (c) => {
  const svc = serviceClient();
  const month = monthKey();
  const [{ data: limits }, { data: rollups }, { data: tenants }] = await Promise.all([
    svc.from("company_usage_limits").select("*"),
    svc.from("company_usage_monthly_rollups").select("*").eq("month", month),
    svc.from("tenants").select("id,name"),
  ]);

  const rollupBy = new Map<string, any>((rollups ?? []).map((r: any) => [r.tenant_id, r]));
  const nameBy = new Map<string, string>((tenants ?? []).map((t: any) => [t.id, t.name]));

  const rows = (limits ?? []).map((l: any) => {
    const r = rollupBy.get(l.tenant_id);
    const revenue = Number(l.monthly_price || 0);
    const cost = Number(r?.total_estimated_cost ?? 0);
    const gp = revenue - cost;
    const margin = revenue > 0 ? (gp / revenue) * 100 : 0;
    let status: "good" | "watch" | "bad" | "losing_money";
    if (margin < 0) status = "losing_money";
    else if (margin < 40) status = "bad";
    else if (margin < 70) status = "watch";
    else status = "good";
    return {
      tenant_id: l.tenant_id,
      name: nameBy.get(l.tenant_id) ?? l.tenant_id,
      plan_name: l.plan_name,
      monthly_price: revenue,
      cost_mtd: cost,
      gross_profit: gp,
      gross_margin_percent: margin,
      status,
      sms_used: r?.sms_count ?? 0, sms_limit: l.sms_monthly_limit,
      ai_prompts_used: r?.ai_prompt_count ?? 0, ai_prompts_limit: l.ai_prompt_monthly_limit,
      ai_tokens_used: r?.ai_token_count ?? 0, ai_tokens_limit: l.ai_token_monthly_limit,
      storage_used: r?.storage_mb ?? 0, storage_limit: l.storage_mb_limit,
      roof_reports_used: r?.roof_report_count ?? 0, roof_reports_limit: l.roof_report_monthly_limit,
    };
  });

  rows.sort((a, b) => b.cost_mtd - a.cost_mtd);
  return jsonOk(c, { rows, month });
});

app.get("/company-detail", async (c) => {
  const tid = c.req.query("tenant_id");
  if (!tid) return jsonErr(c, "validation", "tenant_id required", 400);
  const svc = serviceClient();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: limit }, { data: events }, { data: tenant }] = await Promise.all([
    svc.from("company_usage_limits").select("*").eq("tenant_id", tid).maybeSingle(),
    svc.from("usage_events").select("*").eq("tenant_id", tid).gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }).limit(500),
    svc.from("tenants").select("id,name").eq("id", tid).maybeSingle(),
  ]);

  const byProvider: Record<string, number> = {};
  const byFeature: Record<string, number> = {};
  const byUser: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (const e of events ?? []) {
    const cost = Number((e as any).estimated_cost || 0);
    byProvider[(e as any).provider] = (byProvider[(e as any).provider] ?? 0) + cost;
    if ((e as any).feature_area) byFeature[(e as any).feature_area] = (byFeature[(e as any).feature_area] ?? 0) + cost;
    if ((e as any).user_id) byUser[(e as any).user_id] = (byUser[(e as any).user_id] ?? 0) + cost;
    const day = String((e as any).created_at).slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + cost;
  }

  const totalCost = Object.values(byProvider).reduce((s, n) => s + n, 0);
  const daysElapsed = Math.max(1, new Date().getUTCDate());
  const daysInMonth = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0).getDate();
  const projectedMonthEnd = (totalCost / daysElapsed) * daysInMonth;
  const revenue = Number((limit as any)?.monthly_price ?? 0);
  const projectedMargin = revenue > 0 ? ((revenue - projectedMonthEnd) / revenue) * 100 : 0;

  return jsonOk(c, {
    tenant: tenant ?? { id: tid },
    limit,
    totals: { cost_mtd: totalCost, revenue, projected_month_end: projectedMonthEnd, projected_margin_percent: projectedMargin },
    by_provider: byProvider,
    by_feature: byFeature,
    by_user: byUser,
    by_day: byDay,
    events: events ?? [],
  });
});

app.get("/user-detail", async (c) => {
  const uid = c.req.query("user_id");
  if (!uid) return jsonErr(c, "validation", "user_id required", 400);
  const svc = serviceClient();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { data: events } = await svc
    .from("usage_events").select("*").eq("user_id", uid)
    .gte("created_at", monthStart.toISOString())
    .order("created_at", { ascending: false }).limit(500);

  const totalCost = (events ?? []).reduce((s, e: any) => s + Number(e.estimated_cost || 0), 0);
  const counts: Record<string, number> = {};
  for (const e of events ?? []) {
    counts[(e as any).event_type] = (counts[(e as any).event_type] ?? 0) + 1;
  }
  return jsonOk(c, { user_id: uid, totals: { cost_mtd: totalCost }, event_counts: counts, events: events ?? [] });
});

app.get("/provider-costs", async (c) => {
  const svc = serviceClient();
  const { data } = await svc.from("provider_costs").select("*").order("provider").order("event_type");
  return jsonOk(c, { rows: data ?? [] });
});

app.post("/provider-costs/update", async (c) => {
  let body: any; try { body = await c.req.json(); } catch { return jsonErr(c, "bad_json", "invalid body", 400); }
  const { id, cost_per_unit, markup_percent, is_active } = body ?? {};
  if (!id) return jsonErr(c, "validation", "id required", 400);
  const patch: Record<string, unknown> = {};
  if (cost_per_unit !== undefined) patch.cost_per_unit = Number(cost_per_unit);
  if (markup_percent !== undefined) patch.markup_percent = Number(markup_percent);
  if (is_active !== undefined) patch.is_active = Boolean(is_active);
  const svc = serviceClient();
  const { data, error } = await svc.from("provider_costs").update(patch).eq("id", id).select().single();
  if (error) return jsonErr(c, "update_failed", error.message, 500);
  return jsonOk(c, data);
});

app.post("/seed-test-event", async (c) => {
  let body: any; try { body = await c.req.json(); } catch { body = {}; }
  const { provider = "openai", event_type = "ai_generation", tenant_id = null, user_id = c.get("userId"), quantity = 1 } = body ?? {};
  const svc = serviceClient();
  const { data: cost } = await svc
    .from("provider_costs").select("cost_per_unit, unit, markup_percent")
    .eq("provider", provider).eq("event_type", event_type).maybeSingle();
  const unitCost = Number(cost?.cost_per_unit ?? 0);
  const estimated = unitCost * Number(quantity || 1);
  const { data, error } = await svc.from("usage_events").insert({
    tenant_id, user_id, provider, event_type,
    quantity: Number(quantity || 1), unit: cost?.unit ?? null,
    unit_cost: unitCost, estimated_cost: estimated,
    billable_amount: estimated * (1 + Number(cost?.markup_percent ?? 0) / 100),
    edge_function: "platform-api/seed-test-event",
    metadata: { test: true },
  }).select().single();
  if (error) return jsonErr(c, "insert_failed", error.message, 500);
  return jsonOk(c, data);
});

// ============================================================
// /track-client-usage — authenticated; derives tenant_id from JWT/profile.
// Used by the browser to log client-originated usage (storage uploads,
// map loads, etc.) WITHOUT needing the internal worker secret.
// ============================================================
app.post("/track-client-usage", requireAuth, async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return jsonErr(c, "bad_json", "invalid body", 400); }
  const userId = c.get("userId");
  if (!userId) return jsonErr(c, "unauthorized", "auth required", 401);

  const {
    provider,
    event_type,
    feature_area = null,
    quantity = 1,
    unit = null,
    metadata = {},
  } = body ?? {};
  if (!provider || !event_type) {
    return jsonErr(c, "validation", "provider and event_type required", 400);
  }

  const svc = serviceClient();

  // Resolve tenant from caller's profile (server-side; never trust client).
  let tenantId: string | null = null;
  try {
    const { data: prof } = await svc.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    tenantId = prof?.tenant_id ?? null;
  } catch { /* swallow */ }

  const qty = Number(quantity) || 0;
  const { data: cost } = await svc
    .from("provider_costs")
    .select("cost_per_unit, markup_percent, unit, is_active")
    .eq("provider", provider)
    .eq("event_type", event_type)
    .maybeSingle();
  const unitCost = cost?.is_active ? Number(cost.cost_per_unit) : 0;
  const markup = cost ? Number(cost.markup_percent || 0) : 0;
  const estimatedCost = unitCost * qty;
  const billableAmount = estimatedCost * (1 + markup / 100);
  const resolvedUnit = unit ?? cost?.unit ?? null;

  const meta = { ...(metadata ?? {}) };
  if (!tenantId) meta.needs_company_resolution = true;

  const { data: inserted, error } = await svc.from("usage_events").insert({
    tenant_id: tenantId,
    user_id: userId,
    provider,
    event_type,
    feature_area,
    quantity: qty,
    unit: resolvedUnit,
    unit_cost: unitCost,
    estimated_cost: estimatedCost,
    billable_amount: billableAmount,
    edge_function: "client",
    status: "success",
    metadata: meta,
  }).select().single();

  if (error) return jsonErr(c, "insert_failed", error.message, 500);
  return jsonOk(c, inserted);
});

// ============================================================
// /coverage-checklist — master only. Returns wiring status of each hot path
// based on usage_events from last 30 days.
// ============================================================
app.get("/coverage-checklist", requireAuth, requireMaster, async (c) => {
  const svc = serviceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Definitions: { key, label, provider?, event_type?, statuses? }
  const items: Array<{ key: string; label: string; provider?: string; event_type?: string; match?: (e: any) => boolean }> = [
    { key: "sms_outbound", label: "SMS outbound wired",         provider: "telnyx",    event_type: "sms_outbound" },
    { key: "sms_inbound",  label: "SMS inbound wired",          provider: "telnyx",    event_type: "sms_inbound"  },
    { key: "voice",        label: "Voice wired",                provider: "telnyx",    event_type: "voice_minutes" },
    { key: "ai_calls",     label: "AI calls wired",                                    event_type: "ai_generation" },
    { key: "uploads",      label: "Uploads wired",              provider: "supabase",  event_type: "storage_mb" },
    { key: "map_loads",    label: "Map loads wired",            provider: "mapbox",    event_type: "map_load" },
    { key: "scraping",     label: "Scraping wired",                                    match: (e) => ["firecrawl", "serpapi"].includes(e.provider) || ["scrape_credit", "search"].includes(e.event_type) },
    { key: "roof_reports", label: "Roof reports wired",                                event_type: "roof_report" },
    { key: "heavy_edge",   label: "Heavy edge invocations wired",                      match: (e) => e.event_type === "edge_invocation" },
    { key: "blocked_limit",label: "Limit blocking wired",                              match: (e) => e.status === "blocked_limit" },
  ];

  // Pull last-30d distinct (provider,event_type,status) slim list.
  const { data: events, error } = await svc
    .from("usage_events")
    .select("provider, event_type, status, created_at")
    .gte("created_at", since)
    .limit(5000);
  if (error) return jsonErr(c, "query_failed", error.message, 500);

  const rows = items.map((it) => {
    const seen = (events ?? []).some((e: any) => {
      if (it.match) return it.match(e);
      if (it.provider && e.provider !== it.provider) return false;
      if (it.event_type && e.event_type !== it.event_type) return false;
      return true;
    });
    return { key: it.key, label: it.label, status: seen ? "green" : "red" };
  });

  return jsonOk(c, { rows, window: "30d" });
});

Deno.serve(app.fetch);
