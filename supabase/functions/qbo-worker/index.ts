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
import { qboFetch, stableInvoiceRequestId } from "../_shared/qbo/retry.ts";
import { reconcileInvoiceFromQbo, appendReconciliationEvent } from "../_shared/qbo/reconciler.ts";

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
  // getClaims() is not available in every Supabase Edge Runtime SDK build.
  // getUser(token) validates the bearer against Auth and is supported across
  // the deployed v2 clients, preventing the request from crashing before CORS
  // can return a structured response to the browser.
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return { ok: false, res: err("unauthorized", "Invalid token", requestId, 401) };
  }
  const userId = userData.user.id;

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

  // Parent customer name is the PERSON only — never the address and never the
  // job number. Those belong on the sub-customer job.
  const personName =
    `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
    contact.company_name ||
    "Unknown Customer";

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

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);

  if (existing?.qbo_entity_id) {
    // Rename legacy parents that still carry "Name - Address — JOB-####".
    try {
      const verify = await fetch(
        `${qboHost(connection)}/v3/company/${realmId}/customer/${existing.qbo_entity_id}?minorversion=75`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
      );
      if (verify.ok) {
        const cust = (await verify.json())?.Customer;
        const current = String(cust?.DisplayName ?? "").trim();
        if (cust?.Id && current && current !== personName) {
          await fetch(
            `${qboHost(connection)}/v3/company/${realmId}/customer?minorversion=75`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${access_token}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                Id: cust.Id,
                SyncToken: cust.SyncToken,
                sparse: true,
                DisplayName: personName,
              }),
            },
          );
        }
      }
    } catch (_e) { /* renaming is best-effort */ }
    return existing.qbo_entity_id;
  }

  const payload: Record<string, unknown> = {
    // AccuLynx model: the QBO Customer is the person. Jobs hang off it as
    // sub-customers named by job number, and the address lives on the job.
    DisplayName: personName,
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
  let j: any;
  if (!res.ok) {
    const body = await res.text();
    if (/DisplayNameExists|Duplicate Name Exists|6240/i.test(body)) {
      const name = String(payload.DisplayName ?? "").replace(/'/g, "''");
      const query = encodeURIComponent(`select * from Customer where DisplayName = '${name}'`);
      const foundRes = await fetch(
        `${qboHost(connection)}/v3/company/${realmId}/query?minorversion=75&query=${query}`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
      );
      const found = foundRes.ok ? (await foundRes.json())?.QueryResponse?.Customer?.[0] : null;
      if (!found?.Id) {
        throw new Error(`qbo_customer_duplicate_unresolved [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 300)}`);
      }
      j = { Customer: found };
    } else {
      throw new Error(`qbo_customer_create_failed [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 300)}`);
    }
  } else {
    j = await res.json();
  }
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
function cljJobLabel(clj?: string | null, fallback?: string | null): string {
  // Preferred: location-scoped project number, e.g. "EC-JOB-0001".
  const fb = (fallback ?? "").trim();
  if (/^[A-Za-z0-9]+-JOB-\d+$/.test(fb)) return fb.toUpperCase();
  const raw = (clj ?? "").trim();
  const m = raw.match(/^([A-Za-z0-9]+)-(\d+)-(\d+)-(\d+)$/);
  if (m) return `${m[1].toUpperCase()}-J${String(Number(m[4]))}`;
  return raw || fb;
}

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
  const projectNumber = cljJobLabel(project.clj_formatted_number, project.project_number) || project.id;
  // Uniform across ALL tenants: AccuLynx-style Customer:Job (person parent + job sub-customer).
  // Per-tenant overrides are intentionally ignored so every tenant syncs identically.
  const desiredMode = "sub_customer_job";
  void settings;

  const { access_token } = await getValidAccessToken(service, ctx.tenantId);

  // Check for an existing mapping, but never trust the database row alone. Old
  // mappings may point at a deleted customer or at a legacy non-job customer.
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
    const verify = await fetch(
      `${qboHost(connection)}/v3/company/${realmId}/customer/${row.qbo_entity_id}?minorversion=75`,
      { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
    );
    if (verify.ok) {
      const verified = (await verify.json())?.Customer;
      const isCorrectJob = verified?.Job === true &&
        String(verified?.ParentRef?.value ?? "") === String(parentCustomerId);
      if (isCorrectJob) {
        let currentName = String(verified.DisplayName ?? projectNumber).trim();
        // Rename in place when the canonical job label has changed. Creating a
        // second sub-customer is what produced duplicate job numbers before.
        if (currentName !== String(projectNumber).trim()) {
          const renameRes = await fetch(
            `${qboHost(connection)}/v3/company/${realmId}/customer?minorversion=75`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${access_token}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                Id: verified.Id,
                SyncToken: verified.SyncToken,
                sparse: true,
                DisplayName: String(projectNumber).trim(),
              }),
            },
          );
          if (renameRes.ok) currentName = String(projectNumber).trim();
        }
        return {
          id: row.qbo_entity_id,
          mode: "sub_customer_job",
          display_name: currentName,
        };
      }
    }

    // Retire the stale/legacy mapping so the canonical sub-customer can be
    // persisted under the same unique key below.
    await service.from("qbo_entity_mapping")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("realm_id", realmId)
      .eq("pitch_entity_type", "project")
      .eq("pitch_entity_id", project.id)
      .eq("qbo_entity_type", row.qbo_entity_type);
  }

  // Native Project API (GraphQL) is behind Intuit entitlement and is never used;
  // sub-customer job is the single deterministic path for every tenant.



  // Sub-customer (job) is named by the job number only — the parent customer
  // already carries the person's name (AccuLynx-style Customer:Job).
  const displayName = String(projectNumber).trim();

  // The job address lives on the sub-customer, not on the parent name.
  const jobStreet = project?.address_street ?? contact?.address_street ?? null;
  const jobCity = project?.address_city ?? contact?.address_city ?? null;
  const jobState = project?.address_state ?? contact?.address_state ?? null;
  const jobZip = project?.address_zip ?? contact?.address_zip ?? null;
  const jobAddr = jobStreet || jobCity || jobZip
    ? {
      Line1: jobStreet ?? undefined,
      City: jobCity ?? undefined,
      CountrySubDivisionCode: jobState ?? undefined,
      PostalCode: jobZip ?? undefined,
    }
    : undefined;

  const payload = {
    DisplayName: displayName,
    ParentRef: { value: parentCustomerId },
    Job: true,
    BillWithParent: true,
    Active: true,
    ...(jobAddr ? { ShipAddr: jobAddr, BillAddr: jobAddr } : {}),
    ...(jobStreet ? { Notes: String(jobStreet) } : {}),
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
  let j: any;
  if (!res.ok) {
    const body = await res.text();
    if (/DisplayNameExists|Duplicate Name Exists|6240/i.test(body)) {
      const escaped = displayName.replace(/'/g, "''");
      const query = encodeURIComponent(`select * from Customer where DisplayName = '${escaped}'`);
      const foundRes = await fetch(
        `${qboHost(connection)}/v3/company/${realmId}/query?minorversion=75&query=${query}`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
      );
      const found = foundRes.ok ? (await foundRes.json())?.QueryResponse?.Customer?.[0] : null;
      if (found?.Job === true && String(found?.ParentRef?.value ?? "") === String(parentCustomerId)) {
        j = { Customer: found };
      } else {
        throw new Error(`qbo_sub_customer_name_conflict [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 300)}`);
      }
    } else {
      throw new Error(`qbo_sub_customer_create_failed [status=${res.status} tid=${tid ?? "none"}]: ${body.slice(0, 300)}`);
    }
  } else {
    j = await res.json();
  }
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
      pitch_project_number: cljJobLabel(project.clj_formatted_number, project.project_number) || project.id,
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
  let pipelineEntry: any = null;
  if (project.pipeline_entry_id) {
    const { data: pe } = await service
      .from("pipeline_entries")
      .select("contact_id, estimated_value, metadata, contacts!pipeline_entries_contact_id_fkey(*)")
      .eq("id", project.pipeline_entry_id)
      .maybeSingle();
    pipelineEntry = pe;
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

  // Enhanced estimates are canonically attached to the pipeline entry in the
  // live builder (not the projects row). Resolve the selected estimate first,
  // then the highest non-zero selling price, matching Pipeline and AR.
  const estimateColumns = "id, line_items, selling_price, estimate_number, status, updated_at";
  const { data: projectEstimates } = await service
    .from("enhanced_estimates")
    .select(estimateColumns)
    .eq("tenant_id", ctx.tenantId)
    .eq("project_id", projectId);
  let enhancedEstimates: any[] = projectEstimates ?? [];
  if (project.pipeline_entry_id) {
    const { data: pipelineEstimates } = await service
      .from("enhanced_estimates")
      .select(estimateColumns)
      .eq("tenant_id", ctx.tenantId)
      .eq("pipeline_entry_id", project.pipeline_entry_id);
    const byId = new Map(enhancedEstimates.map((row) => [row.id, row]));
    for (const row of pipelineEstimates ?? []) byId.set(row.id, row);
    enhancedEstimates = [...byId.values()];
  }

  const metadata = (pipelineEntry?.metadata ?? {}) as Record<string, any>;
  const selectedIds = Array.isArray(metadata.selected_estimate_ids)
    ? metadata.selected_estimate_ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const selectedId = metadata.selected_estimate_id ?? metadata.enhanced_estimate_id ?? null;
  let estimate: any = null;

  if (metadata.combine_estimates === true && selectedIds.length > 1) {
    const combined = enhancedEstimates.filter((row) => selectedIds.includes(row.id));
    if (combined.length) {
      const sellingPrice = combined.reduce((sum, row) => sum + Number(row.selling_price ?? 0), 0);
      estimate = {
        ...combined[0],
        id: combined.map((row) => row.id).sort().join("+"),
        estimate_number: combined.map((row) => row.estimate_number).filter(Boolean).join(" + "),
        selling_price: sellingPrice,
      };
    }
  }
  if (!estimate && selectedId) estimate = enhancedEstimates.find((row) => row.id === selectedId) ?? null;
  if (!estimate) {
    estimate = enhancedEstimates
      .filter((row) => Number(row.selling_price ?? 0) > 0)
      .sort((a, b) => Number(b.selling_price ?? 0) - Number(a.selling_price ?? 0))[0] ?? null;
  }
  if (!estimate && enhancedEstimates.length) {
    estimate = enhancedEstimates.sort((a, b) =>
      String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
    )[0];
  }
  if (!estimate) {
    const { data: legacyEstimates } = await service
      .from("estimates")
      .select(estimateColumns)
      .eq("tenant_id", ctx.tenantId)
      .eq("project_id", projectId)
      .order("selling_price", { ascending: false })
      .limit(1);
    estimate = legacyEstimates?.[0] ?? null;
  }
  if (!estimate) return err("no_estimate", "No estimate found for project", ctx.requestId, 400);

  const targetSellingPrice = Math.round(Number(estimate.selling_price ?? 0) * 100) / 100;
  if (targetSellingPrice <= 0) {
    return err("no_selling_price", "Selected estimate has no selling price", ctx.requestId, 400);
  }

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

  // Build one canonical contract line. Estimate line_items contain internal
  // material/labor cost detail and must never become the customer invoice
  // amount. The QBO transaction total is the selected contract selling price.
  const projectNumber = cljJobLabel(project.clj_formatted_number, project.project_number) || project.id;
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

  const projectType = String(
    metadata.project_subtype ?? metadata.project_type ?? metadata.roof_type ?? ""
  ).toLowerCase();
  const preferredCode = projectType.includes("repair")
    ? "roof_repair"
    : projectType.includes("roof") || projectType.includes("shingle") || projectType.includes("tile") || projectType.includes("metal")
      ? "roof_replacement"
      : projectType.includes("gutter") || projectType.includes("soffit") || projectType.includes("fascia")
        ? "gutters"
        : projectType.includes("siding")
          ? "siding"
          : projectType.includes("solar")
            ? "solar"
            : null;
  const fallbackMapping = (preferredCode ? mapByCode.get(preferredCode) : null)
    ?? mapByCode.get("roof_replacement")
    ?? [...mapByCode.values()][0]
    ?? null;
  const contractItemId = fallbackMapping?.qbo_item_id ?? defaultItemId;
  if (!contractItemId) {
    return err("unmapped_items", "No QuickBooks Item is configured for contract invoices.", ctx.requestId, 400, {
      hint: "Configure a job type mapping or set tenant_qbo_settings.default_item_id.",
    });
  }
  pushLine(
    `${project.name ?? "Project"} contract selling price`,
    targetSellingPrice,
    1,
    targetSellingPrice,
    fallbackMapping?.job_type_code ?? preferredCode,
  );

  if (lines.length === 0) {
    return err("unmapped_items", "The contract invoice line could not be mapped to a QuickBooks Item.", ctx.requestId, 400);
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
  // Invoice number ties back to Pitch by default: prefer the project/job label,
  // fall back to the estimate number. Only "qbo_managed" defers to QBO's counter.
  const pitchDocNumber = String(projectNumber ?? estimate.estimate_number ?? "").trim().slice(0, 21);
  if (settings?.invoice_numbering_mode !== "qbo_managed" && pitchDocNumber) {
    invoicePayload.DocNumber = pitchDocNumber;
  }
  if (departmentRef) invoicePayload.DepartmentRef = { value: departmentRef };

  // Retry-safe, idempotent create. Passing a stable `requestid` prevents
  // duplicate QBO invoices even if this handler retries.
  const requestIdForCreate = stableInvoiceRequestId({
    tenantId: ctx.tenantId,
    connectionId: connection.id,
    projectId: project.id,
    estimateId: estimate.id,
  });

  const { data: existingInvoiceMapping } = await service
    .from("qbo_entity_mapping")
    .select("qbo_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("qbo_connection_id", connection.id)
    .eq("realm_id", connection.realm_id)
    .eq("pitch_entity_type", "project")
    .eq("pitch_entity_id", project.id)
    .eq("qbo_entity_type", "Invoice")
    .maybeSingle();

  let invoiceWriteBody = invoicePayload;
  let invoiceWriteUrl = `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice?minorversion=75`;
  let invoiceWriteRequestId: string | undefined = requestIdForCreate;
  if (existingInvoiceMapping?.qbo_entity_id) {
    const currentResult = await qboFetch({
      method: "GET",
      url: `${qboHost(connection)}/v3/company/${connection.realm_id}/invoice/${existingInvoiceMapping.qbo_entity_id}?minorversion=75`,
      getAccessToken: async () => (await getValidAccessToken(service, ctx.tenantId)).access_token,
    });
    const currentInvoice = (currentResult.json as any)?.Invoice;
    if (currentResult.ok && currentInvoice?.Id && currentInvoice?.SyncToken != null) {
      invoiceWriteBody = {
        Id: currentInvoice.Id,
        SyncToken: currentInvoice.SyncToken,
        sparse: true,
        ...invoicePayload,
      };
      invoiceWriteRequestId = undefined;
    }
  }

  let createResult = await qboFetch({
    method: "POST",
    url: invoiceWriteUrl,
    body: invoiceWriteBody,
    requestId: invoiceWriteRequestId,
    getAccessToken: async () => (await getValidAccessToken(service, ctx.tenantId)).access_token,
  });

  // QBO rejects duplicate DocNumbers (error 6140). Retry once letting QBO assign
  // the number — the Pitch project number still rides on PrivateNote/memo.
  if (!createResult.ok && /6140|Duplicate Document Number/i.test(createResult.bodyText ?? "")) {
    const retryBody: any = { ...(invoiceWriteBody as any) };
    delete retryBody.DocNumber;
    createResult = await qboFetch({
      method: "POST",
      url: invoiceWriteUrl,
      body: retryBody,
      requestId: invoiceWriteRequestId ? `${invoiceWriteRequestId}-nodoc` : undefined,
      getAccessToken: async () => (await getValidAccessToken(service, ctx.tenantId)).access_token,
    });
  }

  void writeQboApiLog(service, {
    action: "qbo_worker",
    tenant_id: ctx.tenantId,
    connection_id: connection.id,
    realm_id: connection.realm_id,
    oauth_app_env: connection.oauth_app_env,
    endpoint: `/v3/company/${connection.realm_id}/invoice`,
    method: "POST",
    http_status: createResult.status,
    intuit_tid: createResult.intuitTid,
    success: createResult.ok,
    request_metadata: {
      op: "createInvoiceFromEstimates",
      pitch_project_id: project.id,
      project_number: projectNumber,
      qbo_request_id: requestIdForCreate,
      attempts: createResult.attempts,
    },
  });

  if (!createResult.ok) {
    return err(
      "qbo_invoice_create_failed",
      `QBO error [status=${createResult.status} tid=${createResult.intuitTid ?? "none"} class=${createResult.classification}]: ${createResult.bodyText.slice(0, 400)}`,
      ctx.requestId, 502,
      { intuit_tid: createResult.intuitTid, classification: createResult.classification },
    );
  }

  const invoice = (createResult.json as any)?.Invoice;
  if (!invoice?.Id) {
    return err("qbo_invoice_create_malformed", "QBO create response missing Invoice.Id", ctx.requestId, 502);
  }
  const invoiceType: string = (args?.invoice_type as string | undefined) ?? "other";

  // Persist invoice mapping (single source of truth for reconciler resolution).
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
    metadata: { estimate_id: estimate.id, qbo_request_id: requestIdForCreate },
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,pitch_entity_type,pitch_entity_id,qbo_entity_type" });

  // Seed the mirror row so the reconciler can update in place.
  const seedNow = new Date().toISOString();
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
    invoice_type: invoiceType,
    allow_online_cc: true,
    allow_online_ach: true,
    // Capability defaults; reconciler will overwrite on the enriched read below.
    invoice_link_status: "pending",
    invoice_link_source: "unavailable",
    last_qbo_pull_at: seedNow,
    last_synced_at: seedNow,
    last_sync_error: null,
    created_by: ctx.userId ?? null,
  }, { onConflict: "tenant_id,qbo_connection_id,realm_id,qbo_invoice_id" });

  await appendReconciliationEvent(service, {
    tenant_id: ctx.tenantId,
    qbo_connection_id: connection.id,
    realm_id: connection.realm_id,
    qbo_invoice_id: invoice.Id,
    event_type: "invoice_pushed",
    total_amount: Number(invoice.TotalAmt ?? 0),
    balance_after: Number(invoice.Balance ?? 0),
    authoritative_source: "qbo_read",
    intuit_tid: createResult.intuitTid,
    details: { qbo_request_id: requestIdForCreate, doc_number: invoice.DocNumber ?? null },
  });

  // Push completed Pitch payments against the QBO invoice. The mapping makes
  // this retry-safe: a payment already represented in QBO is never recreated.
  const { data: pitchPayments } = await service
    .from("payments")
    .select("id, amount, payment_method, processed_at, created_at, metadata")
    .eq("tenant_id", ctx.tenantId)
    .eq("project_id", project.id)
    .eq("status", "completed")
    .order("created_at", { ascending: true });

  let remainingQboBalance = Number(invoice.Balance ?? invoice.TotalAmt ?? 0);
  for (const payment of pitchPayments ?? []) {
    if (remainingQboBalance <= 0) break;
    const { data: existingPaymentMap } = await service
      .from("qbo_entity_mapping")
      .select("qbo_entity_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("realm_id", connection.realm_id)
      .eq("pitch_entity_type", "payment")
      .eq("pitch_entity_id", payment.id)
      .eq("qbo_entity_type", "Payment")
      .maybeSingle();
    if (existingPaymentMap?.qbo_entity_id) continue;

    const fee = Number((payment.metadata as any)?.cc_fee_amount ?? 0);
    const paymentAmount = Math.min(remainingQboBalance, Math.max(0, Number(payment.amount ?? 0) - fee));
    if (paymentAmount <= 0) continue;
    const paymentDate = String(payment.processed_at ?? payment.created_at ?? new Date().toISOString()).slice(0, 10);
    const paymentRequestId = `pitch-pay-${payment.id}`;
    const paymentPayload = {
      CustomerRef: { value: subCustomerId },
      TotalAmt: paymentAmount,
      TxnDate: paymentDate,
      PrivateNote: `Pitch payment ${payment.id}; method ${payment.payment_method ?? "unspecified"}`,
      Line: [{
        Amount: paymentAmount,
        LinkedTxn: [{ TxnId: invoice.Id, TxnType: "Invoice" }],
      }],
    };
    const paymentResult = await qboFetch({
      method: "POST",
      url: `${qboHost(connection)}/v3/company/${connection.realm_id}/payment?minorversion=75`,
      body: paymentPayload,
      requestId: paymentRequestId,
      getAccessToken: async () => (await getValidAccessToken(service, ctx.tenantId)).access_token,
    });
    if (!paymentResult.ok) {
      await appendReconciliationEvent(service, {
        tenant_id: ctx.tenantId,
        qbo_connection_id: connection.id,
        realm_id: connection.realm_id,
        qbo_invoice_id: invoice.Id,
        event_type: "sync_error",
        amount_applied: paymentAmount,
        authoritative_source: "worker_computed",
        intuit_tid: paymentResult.intuitTid,
        details: { pitch_payment_id: payment.id, status: paymentResult.status },
      });
      continue;
    }
    const qboPayment = (paymentResult.json as any)?.Payment;
    if (!qboPayment?.Id) continue;
    await service.from("qbo_entity_mapping").upsert({
      tenant_id: ctx.tenantId,
      qbo_connection_id: connection.id,
      realm_id: connection.realm_id,
      pitch_entity_type: "payment",
      pitch_entity_id: payment.id,
      entity_type: "payment",
      entity_id: payment.id,
      qbo_entity_type: "Payment",
      qbo_entity_id: qboPayment.Id,
      sync_token: qboPayment.SyncToken ?? null,
      metadata: { qbo_invoice_id: invoice.Id, amount: paymentAmount, request_id: paymentRequestId },
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,qbo_connection_id,realm_id,pitch_entity_type,pitch_entity_id,qbo_entity_type" });
    remainingQboBalance = Math.max(0, remainingQboBalance - paymentAmount);
  }

  // Enriched re-fetch drives capability persistence + link validation.
  const recon = await reconcileInvoiceFromQbo({
    service,
    tenantId: ctx.tenantId,
    connection,
    qboInvoiceId: invoice.Id,
    trigger: "worker_create",
    logAction: "qbo_worker",
  });

  return ok({
    qbo_invoice_id: invoice.Id,
    doc_number: invoice.DocNumber,
    total: recon.total ?? Number(invoice.TotalAmt ?? 0),
    balance: recon.balance ?? Number(invoice.Balance ?? 0),
    invoice_link: recon.invoiceLink ?? null,
    invoice_link_status: recon.invoiceLinkStatus ?? "unknown",
    invoice_link_source: recon.invoiceLinkSource ?? "unavailable",
    invoice_type: invoiceType,
    mapping_mode: "sub_customer_job",
    project_number: projectNumber,
    unmapped_job_type_codes: unmapped,
    intuit_tid: createResult.intuitTid,
    qbo_request_id: requestIdForCreate,
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

  // Ownership check — reconciler also enforces this, but reject early for clean errors.
  const { data: mapping } = await service
    .from("qbo_entity_mapping")
    .select("pitch_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("qbo_connection_id", connection.id)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .eq("qbo_entity_id", invoiceId)
    .maybeSingle();
  if (!mapping) return err("not_found", "Invoice not mapped to this tenant", ctx.requestId, 404);

  const recon = await reconcileInvoiceFromQbo({
    service,
    tenantId: ctx.tenantId,
    connection,
    qboInvoiceId: invoiceId,
    trigger: "worker_sync",
    logAction: "qbo_worker",
  });

  if (!recon.ok) {
    return err(
      recon.error ?? "qbo_invoice_fetch_failed",
      `status=${recon.status} tid=${recon.intuitTid ?? "none"} class=${recon.errorClassification ?? "?"}`,
      ctx.requestId, 502,
      { intuit_tid: recon.intuitTid, classification: recon.errorClassification },
    );
  }

  return ok({
    qbo_invoice_id: invoiceId,
    total: recon.total ?? 0,
    balance: recon.balance ?? 0,
    paid: !!recon.isPaid,
    invoice_link: recon.invoiceLink ?? null,
    invoice_link_status: recon.invoiceLinkStatus ?? "unknown",
    invoice_link_source: recon.invoiceLinkSource ?? "unavailable",
    intuit_tid: recon.intuitTid,
  }, ctx.requestId);
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
    .select("qbo_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("qbo_connection_id", connection.id)
    .eq("realm_id", connection.realm_id)
    .eq("qbo_entity_type", "Invoice")
    .limit(50);

  const results: any[] = [];
  for (const m of mappings ?? []) {
    const recon = await reconcileInvoiceFromQbo({
      service,
      tenantId: ctx.tenantId,
      connection,
      qboInvoiceId: m.qbo_entity_id as string,
      trigger: "worker_refresh",
      logAction: "qbo_worker",
    });
    results.push({
      qbo_invoice_id: m.qbo_entity_id,
      ok: recon.ok,
      status: recon.status,
      total: recon.total ?? null,
      balance: recon.balance ?? null,
      paid: !!recon.isPaid,
      invoice_link_status: recon.invoiceLinkStatus ?? "unknown",
    });
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

  // Canonical secret names (matches runtime resolver in _shared/qbo-context.ts).
  // Legacy single-pair names are reported as fallback flags but never as canonical.
  const canonicalKeys = [
    "QBO_CLIENT_ID_DEVELOPMENT",
    "QBO_CLIENT_SECRET_DEVELOPMENT",
    "QBO_REDIRECT_URI_DEVELOPMENT",
    "QBO_WEBHOOK_VERIFIER_DEVELOPMENT",
    "QBO_CLIENT_ID_PRODUCTION",
    "QBO_CLIENT_SECRET_PRODUCTION",
    "QBO_REDIRECT_URI_PRODUCTION",
    "QBO_WEBHOOK_VERIFIER_PRODUCTION",
    "QBO_DEFAULT_ENVIRONMENT",
    "QBO_APP_BASE_URL",
  ];
  const legacyKeys = [
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
    "QBO_REDIRECT_URI",
    "QBO_WEBHOOK_VERIFIER_TOKEN",
    "QBO_WEBHOOK_VERIFIER",
    "QBO_ENVIRONMENT",
  ];
  const secrets: Record<string, boolean> = {};
  for (const k of [...canonicalKeys, ...legacyKeys]) {
    const v = Deno.env.get(k);
    secrets[k] = !!(v && v.trim().length > 0);
  }
  // Fallback usage flags: true when canonical is absent AND a legacy fallback covers it.
  const fallbackInUse = {
    development_client:
      (!secrets.QBO_CLIENT_ID_DEVELOPMENT || !secrets.QBO_CLIENT_SECRET_DEVELOPMENT) &&
      !!(secrets.QBO_CLIENT_ID && secrets.QBO_CLIENT_SECRET),
    production_client:
      (!secrets.QBO_CLIENT_ID_PRODUCTION || !secrets.QBO_CLIENT_SECRET_PRODUCTION) &&
      !!(secrets.QBO_CLIENT_ID && secrets.QBO_CLIENT_SECRET),
    development_verifier:
      !secrets.QBO_WEBHOOK_VERIFIER_DEVELOPMENT &&
      !!(secrets.QBO_WEBHOOK_VERIFIER_TOKEN || secrets.QBO_WEBHOOK_VERIFIER),
    production_verifier:
      !secrets.QBO_WEBHOOK_VERIFIER_PRODUCTION &&
      !!(secrets.QBO_WEBHOOK_VERIFIER_TOKEN || secrets.QBO_WEBHOOK_VERIFIER),
    default_environment:
      !secrets.QBO_DEFAULT_ENVIRONMENT && !!secrets.QBO_ENVIRONMENT,
  };

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

  return ok({ secrets, fallback_in_use: fallbackInUse, connections }, ctx.requestId);
}

// =============================================================
// Op: cleanupDuplicateJobs
// Deactivates legacy duplicate job sub-customers left behind by earlier
// naming schemes (JOB-0057 / EC-JOB-0016 / EC-J28 under one parent).
// Never touches a sub-customer that carries a balance or is the mapped one.
// =============================================================
const CANONICAL_JOB_RE = /^[A-Z0-9]+-JOB-\d+$/;

async function opCleanupDuplicateJobs(ctx: Ctx, args: any): Promise<Response> {
  const service = svc();
  const dryRun = args?.dry_run !== false;
  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  const realmId = connection.realm_id as string;
  const { access_token } = await getValidAccessToken(service, ctx.tenantId);

  // Pull every active job sub-customer.
  const jobs: any[] = [];
  for (let start = 1; start < 2000; start += 100) {
    const q = encodeURIComponent(
      `select Id, DisplayName, Job, Active, Balance, SyncToken, ParentRef from Customer where Job = true and Active = true startposition ${start} maxresults 100`,
    );
    const res = await fetch(
      `${qboHost(connection)}/v3/company/${realmId}/query?minorversion=75&query=${q}`,
      { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
    );
    if (!res.ok) break;
    const batch = (await res.json())?.QueryResponse?.Customer ?? [];
    jobs.push(...batch);
    if (batch.length < 100) break;
  }

  const { data: mappings } = await service
    .from("qbo_entity_mapping")
    .select("qbo_entity_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("realm_id", realmId)
    .eq("pitch_entity_type", "project")
    .in("qbo_entity_type", ["Project", "SubCustomerJob"]);
  const mappedIds = new Set((mappings ?? []).map((m: any) => String(m.qbo_entity_id)));

  const groups = new Map<string, any[]>();
  for (const j of jobs) {
    const parent = String(j?.ParentRef?.value ?? "");
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(j);
  }

  const deactivated: string[] = [];
  const kept: string[] = [];
  const needsManualMerge: string[] = [];

  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const score = (j: any) =>
      (mappedIds.has(String(j.Id)) ? 4 : 0) +
      (CANONICAL_JOB_RE.test(String(j.DisplayName ?? "").toUpperCase()) ? 2 : 0) +
      (Number(j.Balance ?? 0) > 0 ? 1 : 0);
    const sorted = [...group].sort((a, b) => score(b) - score(a));
    const canonical = sorted[0];
    kept.push(String(canonical.DisplayName));

    for (const dup of sorted.slice(1)) {
      if (Number(dup.Balance ?? 0) > 0) {
        needsManualMerge.push(`${dup.DisplayName} (balance $${Number(dup.Balance).toFixed(2)})`);
        continue;
      }
      if (dryRun) {
        deactivated.push(String(dup.DisplayName));
        continue;
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
          body: JSON.stringify({ Id: dup.Id, SyncToken: dup.SyncToken, sparse: true, Active: false }),
        },
      );
      void writeQboApiLog(service, {
        action: "qbo_worker",
        tenant_id: ctx.tenantId,
        connection_id: connection.id,
        realm_id: realmId,
        oauth_app_env: connection.oauth_app_env,
        endpoint: `/v3/company/${realmId}/customer`,
        method: "POST",
        http_status: res.status,
        intuit_tid: getIntuitTid(res),
        success: res.ok,
        request_metadata: { op: "deactivateDuplicateJob", qbo_customer_id: dup.Id, display_name: dup.DisplayName },
      });
      if (res.ok) {
        deactivated.push(String(dup.DisplayName));
        await service.from("qbo_entity_mapping")
          .delete()
          .eq("tenant_id", ctx.tenantId)
          .eq("realm_id", realmId)
          .eq("qbo_entity_id", String(dup.Id));
      } else {
        needsManualMerge.push(`${dup.DisplayName} (deactivate failed)`);
      }
    }
  }

  return ok(
    {
      dry_run: dryRun,
      total_job_subcustomers: jobs.length,
      duplicate_groups: [...groups.values()].filter((g) => g.length > 1).length,
      deactivated,
      kept,
      needs_manual_merge: needsManualMerge,
    },
    ctx.requestId,
  );
}

// =============================================================

// =============================================================
// Op: normalizeCustomerNames
// Legacy parents were created as "Name - Address — JOB-####". The parent must
// carry ONLY the person/company name; the address + job number belong on the
// sub-customer job. This renames drifted parents in place (no new records).
// =============================================================
function personNameFromLegacyDisplayName(name: string): string {
  let out = String(name ?? "").trim();
  // Strip trailing job number segment ("— JOB-0057", "- EC-JOB-0016", "EC-J28").
  out = out.replace(/\s*[—–-]\s*[A-Z]{0,4}-?J(?:OB)?-?\d+\s*$/i, "").trim();
  // Strip a trailing address segment separated by dash/em-dash ("Name - 2847 NE 2nd Ave").
  const parts = out.split(/\s+[-–—]\s+/);
  if (parts.length > 1 && /\d/.test(parts[parts.length - 1])) {
    out = parts.slice(0, -1).join(" - ").trim();
  }
  // Trailing address glued without a separator ("Albany Fernandes 2847 Northeast 2nd Avenue").
  const glued = out.match(
    /^(.*?)\s+\d+\s+.*\b(ave|avenue|st|street|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|ter|terrace|pl|place|cir|circle|hwy|highway|pkwy|parkway|trl|trail)\.?$/i,
  );
  if (glued && glued[1].trim()) out = glued[1].trim();
  return out.replace(/[\s,–—-]+$/, "").trim();
}

async function opNormalizeCustomerNames(ctx: Ctx, args: any): Promise<Response> {
  const service = svc();
  const dryRun = args?.dry_run !== false;
  const connection = await loadActiveConnection(service, ctx.tenantId);
  if (!connection) return err("no_active_connection", "No active QuickBooks connection", ctx.requestId, 400);
  const realmId = connection.realm_id as string;
  const { access_token } = await getValidAccessToken(service, ctx.tenantId);

  const qboQuery = async (query: string) => {
    const res = await fetch(
      `${qboHost(connection)}/v3/company/${realmId}/query?minorversion=75&query=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
    );
    if (!res.ok) return null;
    return (await res.json())?.QueryResponse ?? {};
  };

  const postCustomer = async (payload: Record<string, unknown>, logMeta: Record<string, unknown>) => {
    const res = await fetch(`${qboHost(connection)}/v3/company/${realmId}/customer?minorversion=75`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    void writeQboApiLog(service, {
      action: "qbo_worker",
      tenant_id: ctx.tenantId,
      connection_id: connection.id,
      realm_id: realmId,
      oauth_app_env: connection.oauth_app_env,
      endpoint: `/v3/company/${realmId}/customer`,
      method: "POST",
      http_status: res.status,
      intuit_tid: getIntuitTid(res),
      success: res.ok,
      request_metadata: logMeta,
    });
    let reason = "";
    if (!res.ok) {
      try {
        const j = JSON.parse(text);
        reason = j?.Fault?.Error?.[0]?.Detail ?? j?.Fault?.Error?.[0]?.Message ?? text.slice(0, 160);
      } catch {
        reason = text.slice(0, 160);
      }
    }
    return { ok: res.ok, reason };
  };

  const parents: any[] = [];
  for (let start = 1; start < 2000; start += 100) {
    const qr = await qboQuery(
      `select Id, DisplayName, CompanyName, PrintOnCheckName, Job, Active, SyncToken from Customer where Job = false and Active = true startposition ${start} maxresults 100`,
    );
    if (!qr) break;
    const page = qr?.Customer ?? [];
    parents.push(...page);
    if (page.length < 100) break;
  }

  const renamed: Array<{ from: string; to: string }> = [];
  const merged: string[] = [];
  const skipped: string[] = [];
  const byName = new Map<string, any>();
  for (const p of parents) byName.set(String(p.DisplayName ?? "").trim().toLowerCase(), p);

  for (const p of parents) {
    const current = String(p.DisplayName ?? "").trim();
    const target = personNameFromLegacyDisplayName(current);
    if (!target || target === current) continue;

    const collision = byName.get(target.toLowerCase());
    if (collision && collision.Id !== p.Id) {
      // A clean parent already exists — move this parent's sub-jobs under it and retire the drifted record.
      if (dryRun) {
        merged.push(`${current} → merge into "${target}"`);
        continue;
      }
      const subs = (await qboQuery(
        `select Id, DisplayName, SyncToken from Customer where ParentRef = '${p.Id}' maxresults 500`,
      ))?.Customer ?? [];
      let moveFailed = false;
      for (const s of subs) {
        const r = await postCustomer(
          { Id: s.Id, SyncToken: s.SyncToken, sparse: true, ParentRef: { value: collision.Id }, Job: true },
          { op: "reparentSubJob", qbo_customer_id: s.Id, new_parent: collision.Id },
        );
        if (!r.ok) {
          moveFailed = true;
          skipped.push(`${s.DisplayName} (reparent failed: ${r.reason})`);
        }
      }
      if (!moveFailed) {
        const d = await postCustomer(
          { Id: p.Id, SyncToken: p.SyncToken, sparse: true, Active: false },
          { op: "deactivateDuplicateParent", qbo_customer_id: p.Id, name: current },
        );
        if (d.ok) merged.push(`${current} → ${target}`);
        else skipped.push(`${current} (deactivate failed: ${d.reason})`);
      }
      continue;
    }

    if (dryRun) {
      renamed.push({ from: current, to: target });
      continue;
    }

    const payload: Record<string, unknown> = {
      Id: p.Id,
      SyncToken: p.SyncToken,
      sparse: true,
      DisplayName: target,
      PrintOnCheckName: target,
    };
    // Only clear CompanyName when it also carries the address/job noise.
    const company = String(p.CompanyName ?? "").trim();
    if (company && personNameFromLegacyDisplayName(company) !== company) {
      payload.CompanyName = personNameFromLegacyDisplayName(company);
    }
    const r = await postCustomer(payload, {
      op: "renameParentCustomer",
      qbo_customer_id: p.Id,
      from: current,
      to: target,
    });
    if (r.ok) {
      renamed.push({ from: current, to: target });
      byName.set(target.toLowerCase(), { ...p, DisplayName: target });
    } else {
      skipped.push(`${current} (rename failed: ${r.reason})`);
    }
  }

  return ok({ dry_run: dryRun, scanned: parents.length, renamed, merged, skipped }, ctx.requestId);
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
      case "cleanupDuplicateJobs":
      case "cleanup-duplicate-jobs":
        return await opCleanupDuplicateJobs(ctx, args);
      case "normalizeCustomerNames":
      case "normalize-customer-names":
        return await opNormalizeCustomerNames(ctx, args);
      default:
        return err("unknown_op", `Unknown op '${op}'. Supported: preflight, setLocation, syncProject, createInvoiceFromEstimates, toggleOnlinePayments, syncPaymentStatus, refreshAr, backendTemplateStatus, cleanupDuplicateJobs, normalizeCustomerNames`, ctx.requestId, 400);

    }
  } catch (e: any) {
    console.error("[qbo-worker] unhandled error", e);
    return err("internal_error", e?.message ?? String(e), ctx.requestId, 500);
  }
});
