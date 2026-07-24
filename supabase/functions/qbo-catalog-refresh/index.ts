// qbo-catalog-refresh
// Slice 2b — refresh the tenant's connection-scoped QuickBooks accounting
// catalog (Items, Accounts, Classes, Departments, Tax Codes, Terms) plus
// company capabilities, mark stale rows, revalidate every active mapping
// bound to entities that changed, and re-run project accounting resolution
// for affected projects.
//
// Auth model matches resolve-project-accounting: JWT required, tenant is
// resolved server-side from the caller's active company, master users must
// have an explicit active_tenant_id impersonation context.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createServiceClient,
  getValidAccessToken,
  QboReauthRequiredError,
} from "../_shared/qbo-auth.ts";
import { getQboContextForConnection } from "../_shared/qbo-context.ts";
import { getIntuitTid } from "../_shared/qbo-intuit-tid.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MINOR_VERSION = "75";
const PAGE_SIZE = 500;

type EntityKind = "item" | "account" | "class" | "department" | "tax_code" | "terms";
const ALL_ENTITIES: EntityKind[] = [
  "item",
  "account",
  "class",
  "department",
  "tax_code",
  "terms",
];

function json(status: number, body: unknown, requestId: string) {
  return new Response(JSON.stringify({ ...(body as object), requestId }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function qboQuery(
  ctx: ReturnType<typeof getQboContextForConnection>,
  accessToken: string,
  realmId: string,
  sql: string,
): Promise<{ status: number; body: any; intuit_tid: string | null }> {
  const url = `${ctx.accountingBaseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const intuit_tid = getIntuitTid(res);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, intuit_tid };
}

async function fetchAll(
  ctx: ReturnType<typeof getQboContextForConnection>,
  accessToken: string,
  realmId: string,
  entityName: string,
  fieldList: string,
): Promise<{ rows: any[]; error: string | null; intuit_tid: string | null; pages: number }> {
  const rows: any[] = [];
  let start = 1;
  let pages = 0;
  let lastTid: string | null = null;
  // Cap at 40 pages (=20k rows) to prevent runaway loops.
  while (pages < 40) {
    const sql = `SELECT ${fieldList} FROM ${entityName} STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`;
    const { status, body, intuit_tid } = await qboQuery(ctx, accessToken, realmId, sql);
    lastTid = intuit_tid ?? lastTid;
    pages += 1;
    if (status !== 200) {
      const fault = body?.Fault?.Error?.[0];
      const code = fault?.code ?? String(status);
      // 3200/3210 indicates feature disabled; treat as capability-disabled
      const err = `qbo_${entityName.toLowerCase()}_fetch_failed status=${status} code=${code}`;
      return { rows, error: err, intuit_tid: lastTid, pages };
    }
    const chunk = body?.QueryResponse?.[entityName] ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return { rows, error: null, intuit_tid: lastTid, pages };
}

function activeFlag(v: any): boolean {
  return v === true || v === "true" || v === 1;
}

async function upsertItems(
  admin: any,
  tenantId: string,
  connectionId: string,
  realmId: string,
  oauthEnv: string | null,
  rows: any[],
) {
  if (!rows.length) return { inserted: 0, updated: 0, seen: [] as string[] };
  const seen: string[] = [];
  const payload = rows.map((r) => {
    seen.push(String(r.Id));
    return {
      tenant_id: tenantId,
      qbo_connection_id: connectionId,
      realm_id: realmId,
      oauth_app_env: oauthEnv,
      qbo_id: String(r.Id),
      name: r.Name ?? null,
      fully_qualified_name: r.FullyQualifiedName ?? r.Name ?? null,
      item_type: r.Type ?? null,
      active: activeFlag(r.Active),
      taxable: r.Taxable ?? null,
      income_account_id: r.IncomeAccountRef?.value ?? null,
      income_account_name: r.IncomeAccountRef?.name ?? null,
      expense_account_id: r.ExpenseAccountRef?.value ?? null,
      sync_token: r.SyncToken ?? null,
      metadata: r,
      last_synced_at: new Date().toISOString(),
    };
  });
  const { error } = await admin
    .from("qbo_item_cache")
    .upsert(payload, { onConflict: "qbo_connection_id,qbo_id" });
  if (error) throw new Error(`item_upsert_failed: ${error.message}`);
  return { inserted: 0, updated: rows.length, seen };
}

async function upsertAccounts(admin: any, tenantId: string, connectionId: string, realmId: string, oauthEnv: string | null, rows: any[]) {
  if (!rows.length) return { seen: [] as string[] };
  const seen: string[] = [];
  const payload = rows.map((r) => {
    seen.push(String(r.Id));
    return {
      tenant_id: tenantId, qbo_connection_id: connectionId, realm_id: realmId, oauth_app_env: oauthEnv,
      qbo_id: String(r.Id), name: r.Name ?? null, fully_qualified_name: r.FullyQualifiedName ?? r.Name ?? null,
      account_type: r.AccountType ?? null, account_sub_type: r.AccountSubType ?? null,
      classification: r.Classification ?? null, active: activeFlag(r.Active),
      parent_id: r.ParentRef?.value ?? null, current_balance: r.CurrentBalance ?? null,
      sync_token: r.SyncToken ?? null, metadata: r, last_synced_at: new Date().toISOString(),
    };
  });
  const { error } = await admin.from("qbo_account_cache").upsert(payload, { onConflict: "qbo_connection_id,qbo_id" });
  if (error) throw new Error(`account_upsert_failed: ${error.message}`);
  return { seen };
}

async function upsertGeneric(
  admin: any, table: string,
  tenantId: string, connectionId: string, realmId: string, oauthEnv: string | null,
  rows: any[], extra: (r: any) => Record<string, unknown>,
) {
  if (!rows.length) return { seen: [] as string[] };
  const seen: string[] = [];
  const payload = rows.map((r) => {
    seen.push(String(r.Id));
    return {
      tenant_id: tenantId, qbo_connection_id: connectionId, realm_id: realmId, oauth_app_env: oauthEnv,
      qbo_id: String(r.Id), name: r.Name ?? null,
      active: activeFlag(r.Active === undefined ? true : r.Active),
      sync_token: r.SyncToken ?? null, metadata: r, last_synced_at: new Date().toISOString(),
      ...extra(r),
    };
  });
  const { error } = await admin.from(table).upsert(payload, { onConflict: "qbo_connection_id,qbo_id" });
  if (error) throw new Error(`${table}_upsert_failed: ${error.message}`);
  return { seen };
}

async function fetchPreferences(
  ctx: ReturnType<typeof getQboContextForConnection>,
  accessToken: string,
  realmId: string,
) {
  const url = `${ctx.accountingBaseUrl}/v3/company/${realmId}/preferences?minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const intuit_tid = getIntuitTid(res);
  if (!res.ok) return { prefs: null, intuit_tid };
  const body = await res.json();
  return { prefs: body?.Preferences ?? null, intuit_tid };
}

async function recordSyncState(
  admin: any, tenantId: string, connectionId: string, entity: EntityKind,
  args: {
    status: "current" | "partial" | "failed" | "unsupported";
    rows: number; startedAt: string; error?: string | null; intuit_tid?: string | null;
    capability?: "enabled" | "disabled" | "unsupported" | "permission_missing" | null;
    markedStale?: number; pages?: number;
  },
) {
  const now = new Date().toISOString();
  await admin.from("qbo_catalog_sync_state").upsert({
    tenant_id: tenantId,
    qbo_connection_id: connectionId,
    entity_kind: entity,
    refresh_status: args.status,
    capability_status: args.capability ?? null,
    last_full_refresh_at: now,
    last_successful_refresh_at: args.status === "current" || args.status === "partial" ? now : null,
    last_refresh_started_at: args.startedAt,
    last_refresh_completed_at: now,
    last_refresh_error: args.error ?? null,
    last_intuit_tid: args.intuit_tid ?? null,
    rows_fetched: args.rows,
    rows_inserted: 0,
    rows_updated: args.rows,
    rows_marked_stale: args.markedStale ?? 0,
    page_count: args.pages ?? 0,
    updated_at: now,
  }, { onConflict: "qbo_connection_id,entity_kind" });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, requestId);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "unauthorized" }, requestId);
  const token = authHeader.slice(7);

  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const admin = createServiceClient();

  const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json(401, { ok: false, error: "invalid_token" }, requestId);
  const userId = claims.claims.sub as string;

  // Resolve tenant server-side from profile.active_tenant_id / tenant_id
  const { data: profile } = await admin
    .from("profiles").select("active_tenant_id, tenant_id").eq("id", userId).maybeSingle();
  const effectiveTenantId = (profile?.active_tenant_id || profile?.tenant_id) as string | null;
  if (!effectiveTenantId) return json(403, { ok: false, error: "no_tenant" }, requestId);

  // Verify access (real membership OR master impersonation)
  const { data: access } = await admin
    .from("user_company_access").select("id").eq("user_id", userId).eq("tenant_id", effectiveTenantId).maybeSingle();
  let impersonated = false;
  if (!access) {
    const { data: roleRow } = await admin.from("user_roles").select("role")
      .eq("user_id", userId).in("role", ["master", "cob"]).maybeSingle();
    if (!roleRow || profile?.active_tenant_id !== effectiveTenantId) {
      return json(403, { ok: false, error: "forbidden_tenant" }, requestId);
    }
    impersonated = true;
  }

  let bodyIn: any = {};
  try { bodyIn = await req.json(); } catch { /* optional */ }
  const requestedEntities: EntityKind[] = Array.isArray(bodyIn?.entities) && bodyIn.entities.length
    ? bodyIn.entities.filter((e: any) => ALL_ENTITIES.includes(e))
    : ALL_ENTITIES;

  // Look up active connections for this tenant
  const { data: conns, error: connErr } = await admin
    .from("qbo_connections").select("*").eq("tenant_id", effectiveTenantId).eq("is_active", true);
  if (connErr) return json(500, { ok: false, error: "connection_lookup_failed" }, requestId);
  if (!conns || conns.length === 0) return json(400, { ok: false, error: "qbo_not_connected" }, requestId);
  if (conns.length > 1 && !bodyIn?.qbo_connection_id) {
    return json(400, { ok: false, error: "configuration_error", detail: "multiple_active_connections" }, requestId);
  }
  const conn = bodyIn?.qbo_connection_id
    ? conns.find((c: any) => c.id === bodyIn.qbo_connection_id)
    : conns[0];
  if (!conn) return json(400, { ok: false, error: "connection_not_found" }, requestId);

  const startAudit = new Date().toISOString();
  await admin.from("accounting_audit_events").insert({
    tenant_id: effectiveTenantId,
    event_type: "qbo_catalog_refresh_started",
    actor_user_id: userId,
    effective_tenant_id: effectiveTenantId,
    impersonation: impersonated,
    qbo_connection_id: conn.id,
    correlation_id: requestId,
    new_value: { entities: requestedEntities },
  });

  let tokens;
  try {
    tokens = await getValidAccessToken(admin, effectiveTenantId);
  } catch (e) {
    if (e instanceof QboReauthRequiredError) return json(401, { ok: false, error: "qbo_reauth_required" }, requestId);
    return json(502, { ok: false, error: "qbo_token_failed", detail: (e as Error).message }, requestId);
  }
  const ctx = getQboContextForConnection(conn);

  const results: Record<string, any> = {};

  const runEntity = async (
    entity: EntityKind, entityName: string, fields: string,
    upsert: (rows: any[]) => Promise<{ seen: string[] }>,
  ) => {
    if (!requestedEntities.includes(entity)) return;
    const startedAt = new Date().toISOString();
    try {
      const { rows, error, intuit_tid, pages } = await fetchAll(ctx, tokens.access_token, tokens.realm_id, entityName, fields);
      if (error) {
        const cap = /code=3200|code=3210/.test(error) ? "disabled" : null;
        await recordSyncState(admin, effectiveTenantId, conn.id, entity, {
          status: cap ? "unsupported" : "failed",
          rows: 0, startedAt, error, intuit_tid, capability: cap, pages,
        });
        results[entity] = { status: cap ? "unsupported" : "failed", error, rows: 0, pages };
        await admin.from("accounting_audit_events").insert({
          tenant_id: effectiveTenantId, event_type: "qbo_catalog_refresh_failed",
          actor_user_id: userId, effective_tenant_id: effectiveTenantId, impersonation: impersonated,
          qbo_connection_id: conn.id, correlation_id: requestId, intuit_tid,
          new_value: { entity, error },
        });
        return;
      }
      const { seen } = await upsert(rows);
      const markedStale = await admin
        .rpc("mark_qbo_cache_stale", { p_connection_id: conn.id, p_entity_kind: entity, p_seen_ids: seen });
      await recordSyncState(admin, effectiveTenantId, conn.id, entity, {
        status: "current", rows: rows.length, startedAt, intuit_tid,
        markedStale: markedStale.data ?? 0, pages, capability: "enabled",
      });
      results[entity] = { status: "current", rows: rows.length, stale: markedStale.data ?? 0, pages };
      await admin.from("accounting_audit_events").insert({
        tenant_id: effectiveTenantId, event_type: "qbo_catalog_entity_refreshed",
        actor_user_id: userId, effective_tenant_id: effectiveTenantId, impersonation: impersonated,
        qbo_connection_id: conn.id, correlation_id: requestId, intuit_tid,
        new_value: { entity, rows: rows.length, marked_stale: markedStale.data ?? 0 },
      });
    } catch (e) {
      await recordSyncState(admin, effectiveTenantId, conn.id, entity, {
        status: "failed", rows: 0, startedAt, error: (e as Error).message,
      });
      results[entity] = { status: "failed", error: (e as Error).message };
    }
  };

  const oauthEnv = (conn as any).oauth_app_env ?? null;

  await runEntity("item",
    "Item",
    "Id,Name,FullyQualifiedName,Type,Active,Taxable,UnitPrice,IncomeAccountRef,ExpenseAccountRef,AssetAccountRef,ParentRef,Level,SyncToken",
    (rows) => upsertItems(admin, effectiveTenantId, conn.id, tokens.realm_id, oauthEnv, rows));
  await runEntity("account",
    "Account",
    "Id,Name,FullyQualifiedName,AccountType,AccountSubType,Classification,Active,ParentRef,CurrentBalance,SyncToken",
    (rows) => upsertAccounts(admin, effectiveTenantId, conn.id, tokens.realm_id, oauthEnv, rows));
  await runEntity("class",
    "Class", "Id,Name,FullyQualifiedName,Active,ParentRef,SyncToken",
    (rows) => upsertGeneric(admin, "qbo_class_cache", effectiveTenantId, conn.id, tokens.realm_id, oauthEnv, rows,
      (r) => ({ fully_qualified_name: r.FullyQualifiedName ?? r.Name ?? null, parent_id: r.ParentRef?.value ?? null })));
  await runEntity("department",
    "Department", "Id,Name,FullyQualifiedName,Active,ParentRef,SyncToken",
    (rows) => upsertGeneric(admin, "qbo_department_cache", effectiveTenantId, conn.id, tokens.realm_id, oauthEnv, rows,
      (r) => ({ fully_qualified_name: r.FullyQualifiedName ?? r.Name ?? null, parent_id: r.ParentRef?.value ?? null })));
  await runEntity("tax_code",
    "TaxCode", "Id,Name,Active,SyncToken",
    (rows) => upsertGeneric(admin, "qbo_tax_code_cache", effectiveTenantId, conn.id, tokens.realm_id, oauthEnv, rows,
      (_r) => ({ taxable: true })));
  await runEntity("terms",
    "Term", "Id,Name,Active,DueDays,DiscountDays,DiscountPercent,SyncToken",
    (rows) => upsertGeneric(admin, "qbo_terms_cache", effectiveTenantId, conn.id, tokens.realm_id, oauthEnv, rows,
      (r) => ({
        due_days: r.DueDays ?? null, discount_days: r.DiscountDays ?? null,
        discount_percent: r.DiscountPercent ?? null,
      })));

  // Company preferences → capabilities
  try {
    const { prefs, intuit_tid } = await fetchPreferences(ctx, tokens.access_token, tokens.realm_id);
    if (prefs) {
      await admin.from("qbo_company_capabilities").upsert({
        qbo_connection_id: conn.id,
        tenant_id: effectiveTenantId,
        class_tracking_enabled: prefs.AccountingInfoPrefs?.ClassTrackingPerTxn === true
          || prefs.AccountingInfoPrefs?.TrackDepartments === true
          || prefs.ClassTrackingPerTxn === true,
        class_tracking_per_txn: prefs.AccountingInfoPrefs?.ClassTrackingPerTxn === true,
        location_tracking_enabled: prefs.AccountingInfoPrefs?.TrackDepartments === true,
        custom_txn_numbers: prefs.SalesFormsPrefs?.CustomTxnNumbers ?? null,
        projects_enabled: prefs.ProductAndServicesPrefs?.ForSales === true
          || prefs?.SalesFormsPrefs?.UsingProgressInvoicing === true,
        sales_tax_enabled: prefs.TaxPrefs?.UsingSalesTax === true,
        terms_available: true,
        online_payment_available: prefs.EmailMessagesPrefs?.InvoiceMessage != null,
        raw_preferences: prefs,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "qbo_connection_id" });
      results["capabilities"] = { status: "current", intuit_tid };
    }
  } catch (e) {
    results["capabilities"] = { status: "failed", error: (e as Error).message };
  }

  // Revalidate every active mapping on this connection and re-resolve affected projects
  const { data: mappings } = await admin
    .from("project_scope_accounting_mappings")
    .select("id")
    .eq("qbo_connection_id", conn.id)
    .eq("active", true);
  let validated = 0, reresolved = 0;
  for (const m of mappings ?? []) {
    await admin.rpc("validate_scope_mapping", { p_mapping_id: m.id });
    const { data: rc } = await admin.rpc("reresolve_projects_for_mapping", { p_mapping_id: m.id });
    validated += 1;
    reresolved += Number(rc ?? 0);
  }

  const partial = Object.values(results).some((r: any) => r?.status === "failed");

  await admin.from("accounting_audit_events").insert({
    tenant_id: effectiveTenantId,
    event_type: partial ? "qbo_catalog_refresh_partial" : "qbo_catalog_refresh_completed",
    actor_user_id: userId,
    effective_tenant_id: effectiveTenantId,
    impersonation: impersonated,
    qbo_connection_id: conn.id,
    correlation_id: requestId,
    new_value: { results, mappings_validated: validated, projects_reresolved: reresolved, started_at: startAudit },
  });

  return json(200, {
    ok: true,
    data: {
      qbo_connection_id: conn.id,
      realm_id: tokens.realm_id,
      environment: conn.oauth_app_env,
      results,
      mappings_validated: validated,
      projects_reresolved: reresolved,
    },
  }, requestId);
});
