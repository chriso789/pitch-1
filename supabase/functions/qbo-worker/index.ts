// qbo-worker — routed QBO write/read Edge Function.
//
// Replaces the 18-line 501 scaffold. Accepts frontend calls of the shape
//   supabase.functions.invoke("qbo-worker", { body: { op: "...", args: {...} } })
// and also HTTP calls with `x-route: /op-name` for future migration.
//
// Every op:
//   - requires a valid Supabase auth bearer token
//   - resolves the tenant server-side from the caller's profile / user_company_access
//   - never trusts body-supplied tenant_id (any provided value is ignored)
//   - resolves the active qbo_connections row for that tenant
//   - routes hosts + refresh via getQboContextForConnection() → correct env
//   - uses minorversion=75
//   - captures Intuit-Tid on responses (via qbo-intuit-tid helper)
//   - never logs access_token, refresh_token, client_secret, verifier
//
// Ops implemented (this pass):
//   syncProject
//   createInvoiceFromEstimates
//   toggleOnlinePayments
//   setLocation
//   syncPaymentStatus
//   refreshAr
//   preflight

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../_shared/qbo-host.ts";
import { getIntuitTid } from "../_shared/qbo-intuit-tid.ts";
import { writeQboApiLog } from "../_shared/qbo-api.ts";
import { getValidAccessToken } from "../_shared/qbo-auth.ts";
import {
  getQboContextForConnection,
  qboCredentialAvailability,
  getDefaultQboMode,
} from "../_shared/qbo-context.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-route, x-tenant-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ok(data: unknown, requestId: string, status = 200) {
  return new Response(JSON.stringify({ ok: true, success: true, data, ...toLegacy(data), requestId }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Legacy callers read fields directly off the response body (e.g. data.doc_number).
// Mirror plain-object top-level fields so both shapes work.
function toLegacy(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function err(code: string, message: string, requestId: string, status = 400, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ ok: false, success: false, error: message, code, requestId, ...extra }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

interface Ctx {
  requestId: string;
  userId: string;
  tenantId: string;
  bearer: string;
}

async function resolveContext(req: Request): Promise<
  | { ok: true; ctx: Ctx }
  | { ok: false; res: Response }
> {
  const requestId = crypto.randomUUID();
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, res: err("unauthorized", "Missing bearer token", requestId, 401) };
  }
  const token = authHeader.slice(7);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return { ok: false, res: err("unauthorized", "Invalid token", requestId, 401) };
  }
  const userId = String(claimsData.claims.sub);

  const service = svc();
  const requestedTenantId = req.headers.get("x-tenant-id")?.trim() || null;
  let tenantId: string | null = null;

  const { data: profile } = await service
    .from("profiles")
    .select("tenant_id, active_tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (requestedTenantId) {
    const owned =
      profile?.tenant_id === requestedTenantId || profile?.active_tenant_id === requestedTenantId;
    if (owned) {
      tenantId = requestedTenantId;
    } else {
      const { data: access } = await service
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", userId)
        .eq("tenant_id", requestedTenantId)
        .maybeSingle();
      if (access?.tenant_id) tenantId = requestedTenantId;
    }
    if (!tenantId) {
      return { ok: false, res: err("no_tenant", "No access to requested tenant", requestId, 403) };
    }
  } else {
    tenantId = (profile?.active_tenant_id ?? profile?.tenant_id ?? null) as string | null;
    if (!tenantId) {
      const { data: access } = await service
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      tenantId = access?.tenant_id ?? null;
    }
  }

  if (!tenantId) {
    return { ok: false, res: err("no_tenant", "No tenant access for user", requestId, 403) };
  }

  return { ok: true, ctx: { requestId, userId, tenantId, bearer: token } };
}

async function loadActiveConnection(service: SupabaseClient, tenantId: string) {
  const { data, error } = await service
    .from("qbo_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`load_connection_failed: ${error.message}`);
  return data;
}

function requireRealmMatches(connection: { realm_id: string } | null, requestedRealm?: string | null): string {
  if (!connection) throw new Error("no_active_connection");
  const rid = String(connection.realm_id);
  if (requestedRealm && String(requestedRealm) !== rid) {
    throw new Error("realm_mismatch");
  }
  return rid;
}

// =============================================================
// Op: preflight — redacted readiness report
// =============================================================
async function opPreflight(ctx: Ctx): Promise<Response> {
  const service = svc();
  const creds = qboCredentialAvailability();
  const connection = await loadActiveConnection(service, ctx.tenantId);

  const base: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    default_environment: getDefaultQboMode(),
    has_development_credentials: creds.has_development_credentials,
    has_production_credentials: creds.has_production_credentials,
    has_legacy_credentials: creds.has_legacy_credentials,
    connection_present: !!connection,
  };

  if (!connection) {
    return ok({ ...base, ready: false, reason: "no_active_connection" }, ctx.requestId);
  }

  const connCtx = getQboContextForConnection(connection);
  base.oauth_app_env = connection.oauth_app_env ?? null;
  base.is_sandbox = connection.is_sandbox ?? null;
  base.realm_id = connection.realm_id;
  base.company_name = connection.qbo_company_name;
  base.accounting_base_url = connCtx.accountingBaseUrl;
  base.env_matches_default = connCtx.mode === getDefaultQboMode();
  base.token_expires_at = connection.token_expires_at;
  base.refresh_token_expires_at = connection.refresh_token_expires_at;
  base.webhook_verifier_present_for_env = !!connCtx.webhookVerifier;

  // Try token refresh (safe read-only op) + companyinfo probe
  let access_token: string | null = null;
  try {
    const t = await getValidAccessToken(service, ctx.tenantId);
    access_token = t.access_token;
    base.token_refresh_ok = true;
  } catch (e) {
    base.token_refresh_ok = false;
    base.token_refresh_error = e instanceof Error ? e.message : String(e);
  }

  // Preferences probe (Projects/Classes/Locations)
  if (access_token) {
    try {
      const prefsRes = await fetch(
        `${qboHost(connection)}/v3/company/${connection.realm_id}/preferences?minorversion=75`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
      );
      const tid = getIntuitTid(prefsRes);
      void writeQboApiLog(service, {
        action: "qbo_preflight",
        tenant_id: ctx.tenantId,
        connection_id: connection.id,
        realm_id: connection.realm_id,
        oauth_app_env: connection.oauth_app_env,
        endpoint: `/v3/company/${connection.realm_id}/preferences`,
        method: "GET",
        http_status: prefsRes.status,
        intuit_tid: tid,
        success: prefsRes.ok,
        request_metadata: { op: "preferences_probe" },
      });
      if (prefsRes.ok) {
        const p = await prefsRes.json();
        const prefs = p?.Preferences ?? {};
        base.projects_enabled = !!prefs?.ProjectsPrefs?.ProjectsEnabled;
        base.classes_enabled = !!prefs?.ClassTrackingPerTxn || !!prefs?.AccountingInfoPrefs?.TrackDepartments;
        base.locations_enabled = !!prefs?.AccountingInfoPrefs?.TrackDepartments;
        base.custom_txn_numbers = prefs?.SalesFormsPrefs?.CustomTxnNumbers ?? null;
      }
    } catch (e) {
      base.preferences_error = e instanceof Error ? e.message : String(e);
    }
  }

  // Item + mapping counts
  const [{ count: itemsCount }, { count: mappedCount }] = await Promise.all([
    service.from("job_type_item_map").select("*", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("realm_id", connection.realm_id),
    service.from("job_type_item_map").select("*", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("realm_id", connection.realm_id).eq("is_active", true),
  ]);
  base.job_type_mappings_total = itemsCount ?? 0;
  base.job_type_mappings_active = mappedCount ?? 0;

  // Settings
  const { data: settings } = await service
    .from("tenant_qbo_settings")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .maybeSingle();
  base.settings = settings ?? { project_mapping_mode: "auto", invoice_numbering_mode: "qbo_managed" };

  base.ready = base.token_refresh_ok === true && base.job_type_mappings_active !== 0;
  return ok(base, ctx.requestId);
}

// =============================================================
// Op: setLocation — persist active QBO location for a Pitch location
// =============================================================
async function opSetLocation(ctx: Ctx, args: { location_id?: string; qbo_department_id?: string; department_name?: string; realm_id?: string }): Promise<Response> {
  const service = svc();
  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  const realmId = requireRealmMatches(connection, args?.realm_id ?? null);

  if (!args?.location_id) return err("bad_request", "location_id required", ctx.requestId, 400);

  const row = {
    tenant_id: ctx.tenantId,
    qbo_connection_id: connection.id,
    realm_id: realmId,
    location_id: args.location_id,
    qbo_department_id: args.qbo_department_id ?? null,
    department_name: args.department_name ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await service
    .from("qbo_location_map")
    .upsert(row, { onConflict: "tenant_id,qbo_connection_id,realm_id,location_id" })
    .select()
    .maybeSingle();
  if (error) return err("db_error", error.message, ctx.requestId, 500);
  return ok({ mapping: data }, ctx.requestId);
}

// =============================================================
// Shared: resolve or create QBO Customer for a Pitch contact
// =============================================================
async function upsertQboCustomer(
  service: SupabaseClient,
  ctx: Ctx,
  connection: any,
  contact: any,
): Promise<string> {
  const realmId = connection.realm_id as string;

  // Look up existing mapping using NEW canonical columns
  const { data: existing } = await service
    .from("qbo_entity_mapping")
    .select("qbo_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", realmId)
    .eq("pitch_entity_type", "contact")
    .eq("pitch_entity_id", contact.id)
    .eq("qbo_entity_type", "Customer")
    .maybeSingle();
  if (existing?.qbo_entity_id) return existing.qbo_entity_id;

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);

  const payload: Record<string, unknown> = {
    DisplayName:
      contact.company_name ||
      `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
      "Unknown Customer",
    GivenName: contact.first_name ?? undefined,
    FamilyName: contact.last_name ?? undefined,
    CompanyName: contact.company_name ?? undefined,
  };
  if (contact.email) (payload as any).PrimaryEmailAddr = { Address: contact.email };
  if (contact.phone) (payload as any).PrimaryPhone = { FreeFormNumber: contact.phone };
  if (contact.address_street) {
    (payload as any).BillAddr = {
      Line1: contact.address_street,
      City: contact.address_city,
      CountrySubDivisionCode: contact.address_state,
      PostalCode: contact.address_zip,
    };
  }

  const res = await fetch(
    `${qboHost(connection)}/v3/company/${realmId}/customer?minorversion=75`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const tid = getIntuitTid(res);
  void writeQboApiLog(service, {
    action: "qbo_worker",
    tenant_id: ctx.tenantId,
    connection_id: connection.id,
    realm_id: realmId,
    oauth_app_env: connection.oauth_app_env,
    endpoint: `/v3/company/${realmId}/customer`,
    method: "POST",
    http_status: res.status,
    intuit_tid: tid,
    success: res.ok,
    request_metadata: { op: "upsertCustomer", pitch_contact_id: contact.id },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`qbo_customer_create_failed [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  const qboId = j.Customer.Id as string;

  await service.from("qbo_entity_mapping").upsert({
    tenant_id: ctx.tenantId,
    qbo_connection_id: connection.id,
    realm_id: realmId,
    pitch_entity_type: "contact",
    pitch_entity_id: contact.id,
    entity_type: "contact",
    entity_id: contact.id,
    qbo_entity_type: "Customer",
    qbo_entity_id: qboId,
    sync_token: j.Customer.SyncToken ?? null,
    metadata: { display_name: j.Customer.DisplayName },
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,pitch_entity_type,pitch_entity_id,qbo_entity_type" });

  return qboId;
}

// =============================================================
// Shared: resolve or create Project (native or SubCustomerJob)
// =============================================================
async function upsertProjectOrJob(
  service: SupabaseClient,
  ctx: Ctx,
  connection: any,
  project: any,
  contact: any,
  parentCustomerId: string,
  settings: any,
): Promise<{ id: string; mode: "native_project" | "sub_customer_job"; display_name: string }> {
  const realmId = connection.realm_id as string;
  const projectNumber = project.clj_formatted_number ?? project.project_number ?? project.id;
  const desiredMode: string = settings?.project_mapping_mode ?? "auto";

  // Check for existing mapping (Project or SubCustomerJob)
  const { data: existingRows } = await service
    .from("qbo_entity_mapping")
    .select("qbo_entity_id, qbo_entity_type, mapping_mode")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", realmId)
    .eq("pitch_entity_type", "project")
    .eq("pitch_entity_id", project.id)
    .in("qbo_entity_type", ["Project", "SubCustomerJob"]);

  if (existingRows && existingRows.length > 0) {
    const row = existingRows[0];
    return {
      id: row.qbo_entity_id,
      mode: (row.mapping_mode ?? (row.qbo_entity_type === "Project" ? "native_project" : "sub_customer_job")) as any,
      display_name: `[${projectNumber}] — ${project.name ?? ""}`.trim(),
    };
  }

  // For this pass: SubCustomerJob fallback is the deterministic path.
  // Native Project API (GraphQL) is behind Intuit entitlement; if user selects it explicitly,
  // fail loudly rather than assume access.
  if (desiredMode === "native_project") {
    throw new Error("native_project_not_yet_supported: enable auto or sub_customer_job in tenant_qbo_settings");
  }

  const displayName = `[${projectNumber}] — ${(contact.first_name ?? "").trim()} ${(contact.last_name ?? "").trim()}`.trim();

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);
  const payload = {
    DisplayName: displayName,
    ParentRef: { value: parentCustomerId },
    Job: true,
    Active: true,
  };
  const res = await fetch(
    `${qboHost(connection)}/v3/company/${realmId}/customer?minorversion=75`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const tid = getIntuitTid(res);
  void writeQboApiLog(service, {
    action: "qbo_worker",
    tenant_id: ctx.tenantId,
    connection_id: connection.id,
    realm_id: realmId,
    oauth_app_env: connection.oauth_app_env,
    endpoint: `/v3/company/${realmId}/customer`,
    method: "POST",
    http_status: res.status,
    intuit_tid: tid,
    success: res.ok,
    request_metadata: { op: "createSubCustomerJob", pitch_project_id: project.id, project_number: projectNumber },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`qbo_sub_customer_create_failed [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  const qboId = j.Customer.Id as string;

  await service.from("qbo_entity_mapping").upsert({
    tenant_id: ctx.tenantId,
    qbo_connection_id: connection.id,
    realm_id: realmId,
    pitch_entity_type: "project",
    pitch_entity_id: project.id,
    entity_type: "project",
    entity_id: project.id,
    qbo_entity_type: "SubCustomerJob",
    qbo_entity_id: qboId,
    pitch_project_number: String(projectNumber ?? ""),
    mapping_mode: "sub_customer_job",
    sync_token: j.Customer.SyncToken ?? null,
    metadata: { display_name: displayName },
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,pitch_entity_type,pitch_entity_id,qbo_entity_type" });

  return { id: qboId, mode: "sub_customer_job", display_name: displayName };
}

// =============================================================
// Op: syncProject
// =============================================================
async function opSyncProject(ctx: Ctx, args: any): Promise<Response> {
  const service = svc();
  const projectId: string | undefined = args?.project_id ?? args?.projectId;
  if (!projectId) return err("bad_request", "project_id required", ctx.requestId, 400);

  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  requireRealmMatches(connection, args?.realm_id ?? null);

  const { data: project, error: projErr } = await service
    .from("projects")
    .select("id, name, project_number, clj_formatted_number, tenant_id, pipeline_entry_id")
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (projErr) return err("db_error", projErr.message, ctx.requestId, 500);
  if (!project) return err("not_found", "Project not found for this tenant", ctx.requestId, 404);

  // Resolve associated contact via pipeline_entries
  let contact: any = null;
  if (project.pipeline_entry_id) {
    const { data: pe } = await service
      .from("pipeline_entries")
      .select("contact_id, contacts!pipeline_entries_contact_id_fkey(*)")
      .eq("id", project.pipeline_entry_id)
      .maybeSingle();
    contact = (pe as any)?.contacts ?? null;
  }
  if (!contact) return err("no_contact", "No contact associated with project", ctx.requestId, 400);

  const { data: settings } = await service
    .from("tenant_qbo_settings")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .maybeSingle();

  try {
    const customerId = await upsertQboCustomer(service, ctx, connection, contact);
    const projMap = await upsertProjectOrJob(service, ctx, connection, project, contact, customerId, settings);

    return ok({
      pitch_project_id: project.id,
      pitch_project_number: project.clj_formatted_number ?? project.project_number ?? project.id,
      qbo_customer_id: customerId,
      qbo_project_or_job_id: projMap.id,
      mapping_mode: projMap.mode,
      qbo_display_name: projMap.display_name,
    }, ctx.requestId);
  } catch (e: any) {
    return err("sync_project_failed", e?.message ?? String(e), ctx.requestId, 502);
  }
}

// =============================================================
// Op: createInvoiceFromEstimates
// =============================================================
async function opCreateInvoice(ctx: Ctx, args: any): Promise<Response> {
  const service = svc();
  const projectId: string | undefined = args?.project_id ?? args?.projectId ?? args?.job_id;
  if (!projectId) return err("bad_request", "project_id (or job_id) required", ctx.requestId, 400);

  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  requireRealmMatches(connection, args?.realm_id ?? null);

  const { data: project } = await service
    .from("projects")
    .select("id, name, project_number, clj_formatted_number, tenant_id, pipeline_entry_id, location_id")
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!project) return err("not_found", "Project not found for this tenant", ctx.requestId, 404);

  // Locate contact
  let contact: any = null;
  if (project.pipeline_entry_id) {
    const { data: pe } = await service
      .from("pipeline_entries")
      .select("contact_id, contacts!pipeline_entries_contact_id_fkey(*)")
      .eq("id", project.pipeline_entry_id)
      .maybeSingle();
    contact = (pe as any)?.contacts ?? null;
  }
  if (!contact) return err("no_contact", "No contact associated with project", ctx.requestId, 400);

  // Resolve QBO Customer + Project/SubCustomerJob mappings (deterministic)
  const { data: settings } = await service
    .from("tenant_qbo_settings")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .maybeSingle();

  let qboCustomerId: string;
  let subCustomerId: string;
  try {
    qboCustomerId = await upsertQboCustomer(service, ctx, connection, contact);
    const p = await upsertProjectOrJob(service, ctx, connection, project, contact, qboCustomerId, settings);
    subCustomerId = p.id;
  } catch (e: any) {
    return err("customer_or_project_failed", e?.message ?? String(e), ctx.requestId, 502);
  }

  // Load the most recent active/approved estimate for this project
  const { data: estimates } = await service
    .from("estimates")
    .select("id, line_items, selling_price, estimate_number, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const estimate = estimates?.[0];
  if (!estimate) return err("no_estimate", "No estimate found for project", ctx.requestId, 400);

  // Pull job_type_item_map for tenant×realm
  const { data: itemMaps } = await service
    .from("job_type_item_map")
    .select("job_type_code, qbo_item_id, qbo_item_name, qbo_class_id, is_active")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .eq("is_active", true);
  const mapByCode = new Map<string, any>();
  for (const m of itemMaps ?? []) mapByCode.set(String(m.job_type_code).toLowerCase(), m);

  const defaultItemId = settings?.default_item_id ?? null;
  const defaultClassId = settings?.default_class_id ?? null;
  const defaultDeptId = settings?.default_department_id ?? null;

  // Build lines
  const projectNumber = project.clj_formatted_number ?? project.project_number ?? project.id;
  const rawLines: any[] = Array.isArray(estimate.line_items) ? estimate.line_items : [];
  const lines: any[] = [];
  const unmapped: string[] = [];
  let lineNum = 1;

  const pushLine = (desc: string, amount: number, qty: number, unit: number, code: string | null) => {
    const mapping = code ? mapByCode.get(String(code).toLowerCase()) : null;
    const itemId = mapping?.qbo_item_id ?? defaultItemId;
    if (!itemId) {
      unmapped.push(code ?? "(no job_type_code on line)");
      return;
    }
    const line: any = {
      DetailType: "SalesItemLineDetail",
      Amount: Number(amount) || 0,
      Description: `${desc} • Job ${projectNumber}`,
      SalesItemLineDetail: {
        ItemRef: { value: itemId, name: mapping?.qbo_item_name ?? undefined },
        Qty: qty || 1,
        UnitPrice: Number(unit) || 0,
      },
      LineNum: lineNum++,
    };
    if (mapping?.qbo_class_id || defaultClassId) {
      line.SalesItemLineDetail.ClassRef = { value: mapping?.qbo_class_id ?? defaultClassId };
    }
    lines.push(line);
  };

  if (rawLines.length > 0) {
    for (const it of rawLines) {
      pushLine(
        it.description ?? it.name ?? "Line item",
        Number(it.total ?? it.amount ?? 0),
        Number(it.quantity ?? 1),
        Number(it.rate ?? it.unit_price ?? 0),
        it.job_type_code ?? it.jobTypeCode ?? null,
      );
    }
  } else {
    pushLine(project.name ?? "Job invoice", Number(estimate.selling_price ?? 0), 1, Number(estimate.selling_price ?? 0), null);
  }

  if (lines.length === 0) {
    return err("unmapped_items", "One or more estimate line items have no QBO Item mapping.", ctx.requestId, 400, {
      unmapped_job_type_codes: unmapped,
      hint: "Configure job_type_item_map or set tenant_qbo_settings.default_item_id.",
    });
  }

  // Resolve QBO Department for this project's location, if any
  let departmentRef: string | null = null;
  if (project.location_id) {
    const { data: locMap } = await service
      .from("qbo_location_map")
      .select("qbo_department_id, is_active")
      .eq("tenant_id", ctx.tenantId)
      .eq("realm_id", connection.realm_id)
      .eq("location_id", project.location_id)
      .maybeSingle();
    if (locMap?.qbo_department_id && locMap.is_active) departmentRef = locMap.qbo_department_id;
  }
  if (!departmentRef && defaultDeptId) departmentRef = defaultDeptId;

  // Build invoice payload
  const txnDate = new Date().toISOString().split("T")[0];
  const dueDate = new Date(Date.now() + 30 * 86400 * 1000).toISOString().split("T")[0];

  const invoicePayload: any = {
    CustomerRef: { value: subCustomerId ?? qboCustomerId },
    Line: lines,
    TxnDate: txnDate,
    DueDate: dueDate,
    PrivateNote: `PITCH CRM Project ${projectNumber} (${project.id}); Estimate ${estimate.estimate_number ?? estimate.id}`,
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
  };

  if (settings?.customer_visible_project_number) {
    invoicePayload.CustomerMemo = { value: `Project ${projectNumber}` };
  }
  if (settings?.invoice_numbering_mode === "pitch_managed" && estimate.estimate_number) {
    invoicePayload.DocNumber = String(estimate.estimate_number);
  }
  if (departmentRef) invoicePayload.DepartmentRef = { value: departmentRef };

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);
  const res = await fetch(
    `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice?minorversion=75`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(invoicePayload),
    },
  );
  const tid = getIntuitTid(res);
  void writeQboApiLog(service, {
    action: "qbo_worker",
    tenant_id: ctx.tenantId,
    connection_id: connection.id,
    realm_id: connection.realm_id,
    oauth_app_env: connection.oauth_app_env,
    endpoint: `/v3/company/${connection.realm_id}/invoice`,
    method: "POST",
    http_status: res.status,
    intuit_tid: tid,
    success: res.ok,
    request_metadata: { op: "createInvoiceFromEstimates", pitch_project_id: project.id, project_number: projectNumber },
  });
  if (!res.ok) {
    const body = await res.text();
    return err("qbo_invoice_create_failed", `QBO error [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 400)}`, ctx.requestId, 502, { intuit_tid: tid });
  }
  const j = await res.json();
  const invoice = j.Invoice;

  // Persist invoice mapping (separate row — no overwrite of Customer/Project mappings)
  await service.from("qbo_entity_mapping").upsert({
    tenant_id: ctx.tenantId,
    qbo_connection_id: connection.id,
    realm_id: connection.realm_id,
    pitch_entity_type: "project",
    pitch_entity_id: project.id,
    entity_type: "project",
    entity_id: project.id,
    qbo_entity_type: "Invoice",
    qbo_entity_id: invoice.Id,
    qbo_doc_number: invoice.DocNumber ?? null,
    pitch_project_number: String(projectNumber ?? ""),
    sync_token: invoice.SyncToken ?? null,
    metadata: { estimate_id: estimate.id },
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,pitch_entity_type,pitch_entity_id,qbo_entity_type" });

  // AR mirror upsert — one row per QBO invoice (never overwrites project)
  await service.from("invoice_ar_mirror").upsert({
    tenant_id: ctx.tenantId,
    qbo_connection_id: connection.id,
    project_id: project.id,
    realm_id: connection.realm_id,
    qbo_invoice_id: invoice.Id,
    doc_number: invoice.DocNumber ?? null,
    total_amount: Number(invoice.TotalAmt ?? 0),
    balance: Number(invoice.Balance ?? 0),
    tax_amount: Number(invoice.TxnTaxDetail?.TotalTax ?? 0),
    sync_token: invoice.SyncToken ?? null,
    txn_date: invoice.TxnDate ?? null,
    due_date: invoice.DueDate ?? null,
    email_status: invoice.EmailStatus ?? "NotSet",
    qbo_status: invoice.EmailStatus ?? "NotSent",
    last_qbo_pull_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,qbo_invoice_id" });

  return ok({
    qbo_invoice_id: invoice.Id,
    doc_number: invoice.DocNumber,
    total: invoice.TotalAmt,
    balance: invoice.Balance,
    mapping_mode: "sub_customer_job",
    project_number: projectNumber,
    unmapped_job_type_codes: unmapped,
  }, ctx.requestId);
}

// =============================================================
// Op: toggleOnlinePayments
// =============================================================
async function opTogglePayments(ctx: Ctx, args: any): Promise<Response> {
  const service = svc();
  const invoiceId: string | undefined = args?.qbo_invoice_id;
  if (!invoiceId) return err("bad_request", "qbo_invoice_id required", ctx.requestId, 400);

  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  requireRealmMatches(connection, args?.realm_id ?? null);

  // Verify this invoice actually belongs to this tenant (via mapping)
  const { data: mapping } = await service
    .from("qbo_entity_mapping")
    .select("qbo_entity_id, sync_token")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .eq("qbo_entity_id", invoiceId)
    .maybeSingle();
  if (!mapping) return err("not_found", "Invoice not mapped to this tenant", ctx.requestId, 404);

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);

  // Sparse update needs SyncToken. Fetch fresh.
  const getRes = await fetch(
    `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice/${invoiceId}?minorversion=75`,
    { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
  );
  if (!getRes.ok) {
    const body = await getRes.text();
    return err("qbo_invoice_fetch_failed", body.slice(0, 300), ctx.requestId, 502);
  }
  const cur = (await getRes.json()).Invoice;

  const body: any = {
    Id: cur.Id,
    SyncToken: cur.SyncToken,
    sparse: true,
    AllowOnlineCreditCardPayment: !!args.allow_credit_card,
    AllowOnlineACHPayment: !!args.allow_ach,
  };

  const res = await fetch(
    `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice?minorversion=75${args?.send_email ? "&include=invoiceLink" : ""}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const tid = getIntuitTid(res);
  void writeQboApiLog(service, {
    action: "qbo_worker",
    tenant_id: ctx.tenantId,
    connection_id: connection.id,
    realm_id: connection.realm_id,
    oauth_app_env: connection.oauth_app_env,
    endpoint: `/v3/company/${connection.realm_id}/invoice`,
    method: "POST",
    http_status: res.status,
    intuit_tid: tid,
    success: res.ok,
    request_metadata: { op: "toggleOnlinePayments", invoice_id: invoiceId },
  });
  if (!res.ok) {
    const errBody = await res.text();
    return err("qbo_invoice_update_failed", errBody.slice(0, 300), ctx.requestId, 502);
  }
  const j = await res.json();

  // Optionally send email
  if (args?.send_email) {
    const sendRes = await fetch(
      `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice/${invoiceId}/send?minorversion=75`,
      { method: "POST", headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
    );
    void writeQboApiLog(service, {
      action: "qbo_worker",
      tenant_id: ctx.tenantId,
      connection_id: connection.id,
      realm_id: connection.realm_id,
      oauth_app_env: connection.oauth_app_env,
      endpoint: `/v3/company/${connection.realm_id}/invoice/${invoiceId}/send`,
      method: "POST",
      http_status: sendRes.status,
      intuit_tid: getIntuitTid(sendRes),
      success: sendRes.ok,
      request_metadata: { op: "sendInvoiceEmail", invoice_id: invoiceId },
    });
  }

  // Update mapping sync_token
  await service.from("qbo_entity_mapping")
    .update({ sync_token: j.Invoice?.SyncToken ?? null, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .eq("qbo_entity_id", invoiceId);

  return ok({ qbo_invoice_id: invoiceId, updated: true, email_sent: !!args?.send_email }, ctx.requestId);
}

// =============================================================
// Op: syncPaymentStatus — pull a QBO invoice and update AR
// =============================================================
async function opSyncPaymentStatus(ctx: Ctx, args: any): Promise<Response> {
  const service = svc();
  const invoiceId: string | undefined = args?.qbo_invoice_id;
  if (!invoiceId) return err("bad_request", "qbo_invoice_id required", ctx.requestId, 400);

  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  requireRealmMatches(connection, args?.realm_id ?? null);

  // Confirm mapping ownership
  const { data: mapping } = await service
    .from("qbo_entity_mapping")
    .select("pitch_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .eq("qbo_entity_id", invoiceId)
    .maybeSingle();
  if (!mapping) return err("not_found", "Invoice not mapped to this tenant", ctx.requestId, 404);

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);
  const res = await fetch(
    `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice/${invoiceId}?minorversion=75`,
    { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
  );
  const tid = getIntuitTid(res);
  void writeQboApiLog(service, {
    action: "qbo_worker",
    tenant_id: ctx.tenantId,
    connection_id: connection.id,
    realm_id: connection.realm_id,
    oauth_app_env: connection.oauth_app_env,
    endpoint: `/v3/company/${connection.realm_id}/invoice/${invoiceId}`,
    method: "GET",
    http_status: res.status,
    intuit_tid: tid,
    success: res.ok,
    request_metadata: { op: "syncPaymentStatus", invoice_id: invoiceId },
  });
  if (!res.ok) {
    const b = await res.text();
    return err("qbo_invoice_fetch_failed", b.slice(0, 300), ctx.requestId, 502);
  }
  const inv = (await res.json()).Invoice;

  await service.from("invoice_ar_mirror")
    .update({
      total_amount: Number(inv.TotalAmt ?? 0),
      balance: Number(inv.Balance ?? 0),
      sync_token: inv.SyncToken ?? null,
      email_status: inv.EmailStatus ?? null,
      qbo_status: inv.Balance > 0 ? "Open" : "Paid",
      last_qbo_pull_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_invoice_id", invoiceId);

  return ok({ qbo_invoice_id: invoiceId, total: inv.TotalAmt, balance: inv.Balance, paid: Number(inv.Balance ?? 0) === 0 }, ctx.requestId);
}

// =============================================================
// Op: refreshAr — refresh all mapped invoices for this tenant
// =============================================================
async function opRefreshAr(ctx: Ctx, _args: any): Promise<Response> {
  const service = svc();
  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);

  const { data: mappings } = await service
    .from("qbo_entity_mapping")
    .select("qbo_entity_id, pitch_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .limit(50);

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);
  const results: any[] = [];
  for (const m of mappings ?? []) {
    try {
      const res = await fetch(
        `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice/${m.qbo_entity_id}?minorversion=75`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
      );
      if (!res.ok) {
        results.push({ qbo_invoice_id: m.qbo_entity_id, ok: false, status: res.status });
        continue;
      }
      const inv = (await res.json()).Invoice;
      await service.from("invoice_ar_mirror")
        .update({
          total_amount: Number(inv.TotalAmt ?? 0),
          balance: Number(inv.Balance ?? 0),
          sync_token: inv.SyncToken ?? null,
          email_status: inv.EmailStatus ?? null,
          qbo_status: inv.Balance > 0 ? "Open" : "Paid",
          last_qbo_pull_at: new Date().toISOString(),
        })
        .eq("tenant_id", ctx.tenantId)
        .eq("realm_id", connection.realm_id)
        .eq("qbo_invoice_id", m.qbo_entity_id);
      results.push({ qbo_invoice_id: m.qbo_entity_id, ok: true, total: inv.TotalAmt, balance: inv.Balance });
    } catch (e) {
      results.push({ qbo_invoice_id: m.qbo_entity_id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return ok({ refreshed: results.length, results }, ctx.requestId);
}

// =============================================================
// Backend template status (master-only, NOT tenant-scoped)
// =============================================================
// Returns Intuit-app secret PRESENCE flags (never the values) and the
// full tenant-connection roster for the developer admin surface. The
// per-tenant OAuth / mapping / webhook feed lives in each tenant's own
// Settings — this op only powers the shared backend-template view.
async function opBackendTemplateStatus(ctx: Ctx) {
  const service = svc();

  // Gate to master role. We already have ctx.userId from resolveContext.
  const { data: isMaster } = await service.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "master" as any,
  });
  if (!isMaster) {
    return err("forbidden", "backendTemplateStatus is master-only", ctx.requestId, 403);
  }

  const secretKeys = [
    "QBO_CLIENT_ID_PRODUCTION",
    "QBO_CLIENT_SECRET_PRODUCTION",
    "QBO_REDIRECT_URI_PRODUCTION",
    "QBO_CLIENT_ID_SANDBOX",
    "QBO_CLIENT_SECRET_SANDBOX",
    "QBO_REDIRECT_URI_SANDBOX",
    "QBO_WEBHOOK_VERIFIER_TOKEN",
  ];
  const secrets: Record<string, boolean> = {};
  for (const k of secretKeys) {
    const v = Deno.env.get(k);
    secrets[k] = !!(v && v.trim().length > 0);
  }

  // Roster of connected tenants (all environments, active only).
  const { data: rows } = await service
    .from("qbo_connections")
    .select("tenant_id, realm_id, is_sandbox, oauth_app_env, created_at, active_location_id, tenants(name)")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(500);

  const connections = (rows ?? []).map((r: any) => ({
    tenant_id: r.tenant_id,
    tenant_name: r.tenants?.name ?? null,
    realm_id: r.realm_id,
    oauth_app_env: r.oauth_app_env,
    is_sandbox: r.is_sandbox,
    connected_at: r.created_at,
    active_location_id: r.active_location_id,
  }));

  return ok({ secrets, connections }, ctx.requestId);
}

// =============================================================
// Dispatcher
// =============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (url.pathname.endsWith("/__health")) {
    return new Response(JSON.stringify({ ok: true, fn: "qbo-worker" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resolved = await resolveContext(req);
  if (!resolved.ok) return resolved.res;
  const ctx = resolved.ctx;

  // Determine op: body.op OR x-route header (`/op-name` normalized to camelCase-ish)
  let op = req.headers.get("x-route")?.replace(/^\//, "") ?? "";
  let args: any = {};
  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      if (!op && typeof body.op === "string") op = body.op;
      args = body.args ?? body ?? {};
    }
  } catch { /* no body */ }

  // Ignore any tenant_id / realm_id override that doesn't match the resolved tenant
  if (args && typeof args === "object") {
    delete (args as any).tenant_id;
  }

  try {
    switch (op) {
      case "preflight":
      case "preFlight":
        return await opPreflight(ctx);
      case "setLocation":
      case "set-location":
        return await opSetLocation(ctx, args);
      case "syncProject":
      case "sync-project":
        return await opSyncProject(ctx, args);
      case "createInvoiceFromEstimates":
      case "createInvoice":
      case "create-invoice":
        return await opCreateInvoice(ctx, args);
      case "toggleOnlinePayments":
      case "toggle-online-payments":
        return await opTogglePayments(ctx, args);
      case "syncPaymentStatus":
      case "sync-payment-status":
        return await opSyncPaymentStatus(ctx, args);
      case "refreshAr":
      case "refresh-ar":
        return await opRefreshAr(ctx, args);
      case "backendTemplateStatus":
      case "backend-template-status":
        return await opBackendTemplateStatus(ctx);
      default:
        return err("unknown_op", `Unknown op '${op}'. Supported: preflight, setLocation, syncProject, createInvoiceFromEstimates, toggleOnlinePayments, syncPaymentStatus, refreshAr, backendTemplateStatus`, ctx.requestId, 400);
    }
  } catch (e: any) {
    console.error("[qbo-worker] unhandled error", e);
    return err("internal_error", e?.message ?? String(e), ctx.requestId, 500);
  }
});
