// qbo-project-sync (Slice 3)
// -----------------------------------------------------------------------------
// Creates or repairs the QuickBooks Customer/Job record that represents a Pitch
// Project, and persists a project_qbo_mappings row. NO invoice / AR side-effects.
//
// Rules (see project spec):
//   • Each Pitch Project maps to exactly one QBO Customer (representation
//     strategy = project_as_customer).
//   • Contacts are CRM-only; no QBO Customer is created just because a contact
//     exists.
//   • Never trust tenant_id from the request body — always resolve from the
//     project row.
//   • Master users may act on another tenant only when their profile's
//     active_tenant_id matches that tenant (impersonation gate).
//   • Auto and manual triggers use the SAME operation; manual is only enabled
//     when the same gates pass.
//   • Failures never create AR and never silently mark the project 'ready'.
// -----------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { qboFetch } from "../_shared/qbo-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReqBody = {
  project_id?: string;
  trigger?: "auto" | "manual";
};

function json(status: number, body: unknown, requestId: string) {
  return new Response(JSON.stringify({ ...(body as object), requestId }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function shortAddress(street?: string | null, city?: string | null): string | null {
  const s = (street ?? "").trim();
  const c = (city ?? "").trim();
  if (s && c) return `${s}, ${c}`;
  return s || c || null;
}

const PLACEHOLDER_PROJECT_NAMES = [
  "project from pipeline entry",
  "new project",
  "untitled project",
];

function isPlaceholderName(name: string): boolean {
  return !name || PLACEHOLDER_PROJECT_NAMES.includes(name.toLowerCase());
}

function buildDisplayName(opts: {
  project_name?: string | null;
  job_number?: string | null;
  fallback_name?: string | null;
  fallback_address?: string | null;
}): string {
  let projectName = (opts.project_name ?? "").trim();
  if (isPlaceholderName(projectName)) {
    const person = (opts.fallback_name ?? "").trim();
    const addr = (opts.fallback_address ?? "").trim();
    projectName = [person, addr].filter(Boolean).join(" - ").trim();
  }
  const jobNumber = (opts.job_number ?? "").trim();
  const dn = [projectName, jobNumber].filter(Boolean).join(" — ").trim();
  // QBO DisplayName max is 100 chars.
  return dn.length > 100 ? dn.slice(0, 100) : dn || "Pitch Project";
}


async function emitAudit(
  admin: SupabaseClient,
  row: {
    tenant_id: string;
    event_type: string;
    project_id: string;
    qbo_connection_id?: string | null;
    actor_user_id?: string | null;
    old_value?: unknown;
    new_value?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await admin.from("accounting_audit_events").insert({
      tenant_id: row.tenant_id,
      effective_tenant_id: row.tenant_id,
      event_type: row.event_type,
      project_id: row.project_id,
      qbo_connection_id: row.qbo_connection_id ?? null,
      actor_user_id: row.actor_user_id ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
      metadata: row.metadata ?? {},
    });
  } catch (_e) { /* best-effort */ }
}

async function setReadiness(
  admin: SupabaseClient,
  projectId: string,
  snapshotId: string | null,
  newState: string,
  tenantId: string,
  connId: string | null,
  actorUserId: string | null,
  oldState: string | null,
  extra: Record<string, unknown> = {},
) {
  await admin.from("projects").update({ accounting_readiness: newState, updated_at: new Date().toISOString() }).eq("id", projectId);
  if (snapshotId) {
    await admin.from("project_accounting_snapshots").update({ accounting_readiness: newState }).eq("id", snapshotId);
  }
  if (oldState !== newState) {
    await emitAudit(admin, {
      tenant_id: tenantId,
      event_type: "project_accounting_readiness_changed",
      project_id: projectId,
      qbo_connection_id: connId,
      actor_user_id: actorUserId,
      old_value: { accounting_readiness: oldState },
      new_value: { accounting_readiness: newState },
      metadata: extra,
    });
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" }, requestId);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "unauthorized" }, requestId);
  const token = authHeader.slice(7);

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json(401, { ok: false, error: "invalid_token" }, requestId);
  const userId = claims.claims.sub as string;

  let body: ReqBody = {};
  try { body = (await req.json()) as ReqBody; } catch { return json(400, { ok: false, error: "invalid_json" }, requestId); }
  if (!body.project_id) return json(400, { ok: false, error: "project_id_required" }, requestId);
  const trigger = body.trigger === "manual" ? "manual" : "auto";
  const projectId = body.project_id;

  // Load project (authoritative tenant).
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, tenant_id, project_number, clj_formatted_number, name, pipeline_entry_id, accounting_readiness, current_accounting_snapshot_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr || !project) return json(404, { ok: false, error: "project_not_found" }, requestId);
  const tenantId = project.tenant_id as string;

  // Access gate: master impersonation OR direct tenant access.
  const { data: profile } = await admin
    .from("profiles")
    .select("role, active_tenant_id")
    .eq("id", userId)
    .maybeSingle();

  const isMaster = profile?.role === "master";
  let hasAccess = false;
  if (isMaster) {
    hasAccess = profile?.active_tenant_id === tenantId;
    if (!hasAccess) {
      return json(403, {
        ok: false,
        error: "master_impersonation_required",
        details: { expected_active_tenant: tenantId },
      }, requestId);
    }
  } else {
    const { data: access } = await admin
      .from("user_company_access")
      .select("id")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    hasAccess = !!access;
    if (!hasAccess) return json(403, { ok: false, error: "forbidden" }, requestId);
  }

  const oldReadiness = project.accounting_readiness as string | null;

  // Readiness gate — must have mappings resolved.
  const allowedGate = new Set([
    // Customer/job identity can be created before account classification is
    // complete. These states still remain unresolved after the QBO link is made.
    "pending_classification",
    "needs_mapping",
    "qbo_sync_pending",
    "qbo_sync_queued",
    "qbo_sync_in_progress",
    "qbo_sync_error",
    "qbo_duplicate_review_required",
    "ready", // allow "repair / verify" from ready
  ]);
  if (!oldReadiness || !allowedGate.has(oldReadiness)) {
    return json(409, {
      ok: false,
      error: "readiness_not_syncable",
      details: { accounting_readiness: oldReadiness },
    }, requestId);
  }

  // Load active QBO connection.
  const { data: connections, error: connErr } = await admin
    .from("qbo_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (connErr) return json(500, { ok: false, error: "connection_lookup_failed" }, requestId);
  if (!connections || connections.length === 0) {
    await setReadiness(admin, projectId, project.current_accounting_snapshot_id, "qbo_not_connected", tenantId, null, userId, oldReadiness);
    return json(409, { ok: false, error: "qbo_not_connected" }, requestId);
  }
  if (connections.length > 1) {
    return json(409, { ok: false, error: "multiple_active_qbo_connections", details: { count: connections.length } }, requestId);
  }
  const connection = connections[0];
  const connId = connection.id as string;

  // Load contact via pipeline_entries → contacts.
  let contact: Record<string, any> | null = null;
  if (project.pipeline_entry_id) {
    const { data: pe } = await admin
      .from("pipeline_entries")
      .select("contact_id")
      .eq("id", project.pipeline_entry_id)
      .maybeSingle();
    if (pe?.contact_id) {
      const { data: c } = await admin
        .from("contacts")
        .select("id, first_name, last_name, company_name, email, phone, address_street, address_city, address_state, address_zip")
        .eq("id", pe.contact_id)
        .maybeSingle();
      contact = c ?? null;
    }
  }

  const contactName =
    contact?.company_name ||
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() ||
    null;
  const addressShort = shortAddress(contact?.address_street, contact?.address_city);
  const displayName = buildDisplayName({
    project_name: project.name as string | null,
    job_number: project.project_number as string | null,
    fallback_name: contactName,
    fallback_address: contact?.address_street ?? null,
  });


  // Load or create mapping row.
  const { data: existing } = await admin
    .from("project_qbo_mappings")
    .select("*")
    .eq("pitch_project_id", projectId)
    .eq("qbo_connection_id", connId)
    .eq("is_active", true)
    .maybeSingle();

  const correlationId = crypto.randomUUID();

  let mappingId: string;
  if (existing) {
    mappingId = existing.id;
    // If already ready & customer verified, short-circuit as a verification pass.
    if (existing.sync_status === "ready" && existing.qbo_customer_id) {
      await admin.from("project_qbo_mappings").update({
        last_verified_at: new Date().toISOString(),
        correlation_id: correlationId,
      }).eq("id", mappingId);
      await emitAudit(admin, {
        tenant_id: tenantId, event_type: "qbo_project_verified",
        project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
        metadata: { trigger, correlation_id: correlationId, qbo_customer_id: existing.qbo_customer_id },
      });
      return json(200, {
        ok: true,
        data: {
          mapping_id: mappingId,
          qbo_customer_id: existing.qbo_customer_id,
          sync_status: "ready",
          verified: true,
        },
      }, requestId);
    }
    await admin.from("project_qbo_mappings").update({
      sync_status: "creating",
      last_error: null,
      correlation_id: correlationId,
      qbo_display_name: displayName,
    }).eq("id", mappingId);
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("project_qbo_mappings")
      .insert({
        tenant_id: tenantId,
        qbo_connection_id: connId,
        pitch_project_id: projectId,
        pitch_contact_id: contact?.id ?? null,
        representation_strategy: "project_as_customer",
        qbo_display_name: displayName,
        sync_status: "creating",
        correlation_id: correlationId,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return json(500, { ok: false, error: "mapping_insert_failed", details: insErr?.message }, requestId);
    }
    mappingId = inserted.id;
  }

  await emitAudit(admin, {
    tenant_id: tenantId,
    event_type: trigger === "manual" ? "qbo_project_manual_retry_requested" : "qbo_project_creation_queued",
    project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
    metadata: { trigger, correlation_id: correlationId, display_name: displayName },
  });

  await setReadiness(admin, projectId, project.current_accounting_snapshot_id, "qbo_sync_in_progress",
    tenantId, connId, userId, oldReadiness, { trigger, correlation_id: correlationId });

  await emitAudit(admin, {
    tenant_id: tenantId, event_type: "qbo_project_creation_started",
    project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
    metadata: { trigger, correlation_id: correlationId },
  });

  // Build the QBO Customer payload.
  const customerPayload: Record<string, unknown> = {
    DisplayName: displayName,
    CompanyName: contact?.company_name ?? undefined,
    GivenName: contact?.first_name ?? undefined,
    FamilyName: contact?.last_name ?? undefined,
    Notes: `Pitch Project ${project.clj_formatted_number ?? project.project_number ?? projectId}`,
  };
  if (contact?.email) customerPayload.PrimaryEmailAddr = { Address: contact.email };
  if (contact?.phone) customerPayload.PrimaryPhone = { FreeFormNumber: contact.phone };
  if (contact?.address_street || contact?.address_city || contact?.address_zip) {
    customerPayload.BillAddr = {
      Line1: contact?.address_street ?? undefined,
      City: contact?.address_city ?? undefined,
      CountrySubDivisionCode: contact?.address_state ?? undefined,
      PostalCode: contact?.address_zip ?? undefined,
    };
  }

  const idempotencyKey = `qbo-project-sync:${projectId}:${connId}`;

  let created: any = null;
  let intuitTid: string | null = null;
  let httpStatus = 0;
  let errorBody = "";

  try {
    const { response, intuit_tid } = await qboFetch(
      admin,
      connection as any,
      `/v3/company/${connection.realm_id}/customer?minorversion=73`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Request-Id": idempotencyKey,
        },
        body: JSON.stringify(customerPayload),
      },
      {
        action: "qbo_project_sync",
        op: "customer.create",
        tenant_id: tenantId,
        connection_id: connId,
        user_id: userId,
        qbo_entity: "Customer",
      },
    );
    intuitTid = intuit_tid;
    httpStatus = response.status;
    const text = await response.text();
    if (!response.ok) {
      errorBody = text;
      throw new Error(`qbo_customer_create_failed [${response.status}]: ${text.slice(0, 500)}`);
    }
    try { created = JSON.parse(text); } catch { created = null; }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const isDuplicate =
      /DisplayNameExists|6240|Duplicate Name Exists/i.test(errorBody) ||
      /DisplayNameExists|6240|Duplicate Name Exists/i.test(msg);

    if (isDuplicate) {
      await admin.from("project_qbo_mappings").update({
        sync_status: "duplicate_review_required",
        last_error: msg.slice(0, 500),
        last_intuit_tid: intuitTid,
      }).eq("id", mappingId);
      await emitAudit(admin, {
        tenant_id: tenantId, event_type: "qbo_project_duplicate_review_required",
        project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
        metadata: { trigger, correlation_id: correlationId, intuit_tid: intuitTid, display_name: displayName },
      });
      await setReadiness(admin, projectId, project.current_accounting_snapshot_id,
        "qbo_duplicate_review_required", tenantId, connId, userId, "qbo_sync_in_progress",
        { correlation_id: correlationId });
      return json(409, {
        ok: false,
        error: "qbo_duplicate_review_required",
        details: { display_name: displayName, intuit_tid: intuitTid },
      }, requestId);
    }

    await admin.from("project_qbo_mappings").update({
      sync_status: "sync_error",
      last_error: msg.slice(0, 500),
      last_intuit_tid: intuitTid,
    }).eq("id", mappingId);
    await emitAudit(admin, {
      tenant_id: tenantId, event_type: "qbo_project_creation_failed",
      project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
      metadata: { trigger, correlation_id: correlationId, intuit_tid: intuitTid, http_status: httpStatus, error: msg.slice(0, 500) },
    });
    await setReadiness(admin, projectId, project.current_accounting_snapshot_id,
      "qbo_sync_error", tenantId, connId, userId, "qbo_sync_in_progress",
      { correlation_id: correlationId });
    return json(502, { ok: false, error: "qbo_customer_create_failed", details: { intuit_tid: intuitTid, http_status: httpStatus, message: msg.slice(0, 500) } }, requestId);
  }

  const customer = created?.Customer;
  const qboCustomerId = customer?.Id ?? null;
  const syncToken = customer?.SyncToken ?? "0";

  if (!qboCustomerId) {
    await admin.from("project_qbo_mappings").update({
      sync_status: "sync_error",
      last_error: "qbo_customer_create_returned_no_id",
      last_intuit_tid: intuitTid,
    }).eq("id", mappingId);
    await setReadiness(admin, projectId, project.current_accounting_snapshot_id,
      "qbo_sync_error", tenantId, connId, userId, "qbo_sync_in_progress");
    return json(502, { ok: false, error: "qbo_customer_create_returned_no_id" }, requestId);
  }

  await emitAudit(admin, {
    tenant_id: tenantId, event_type: "qbo_project_customer_created",
    project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
    metadata: {
      trigger, correlation_id: correlationId, intuit_tid: intuitTid,
      qbo_customer_id: qboCustomerId, display_name: displayName,
    },
  });

  const now = new Date().toISOString();
  await admin.from("project_qbo_mappings").update({
    qbo_customer_id: qboCustomerId,
    qbo_sync_token: syncToken,
    qbo_display_name: displayName,
    sync_status: "ready",
    last_synced_at: now,
    last_verified_at: now,
    last_error: null,
    last_intuit_tid: intuitTid,
  }).eq("id", mappingId);

  await emitAudit(admin, {
    tenant_id: tenantId, event_type: "qbo_project_mapping_persisted",
    project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
    metadata: { trigger, correlation_id: correlationId, qbo_customer_id: qboCustomerId },
  });

  // Verification read.
  try {
    const { response: vRes, intuit_tid: vTid } = await qboFetch(
      admin, connection as any,
      `/v3/company/${connection.realm_id}/customer/${qboCustomerId}?minorversion=73`,
      { method: "GET", headers: { Accept: "application/json" } },
      { action: "qbo_project_sync", op: "customer.verify", tenant_id: tenantId, connection_id: connId, user_id: userId, qbo_entity: "Customer", qbo_entity_id: qboCustomerId },
    );
    if (vRes.ok) {
      await emitAudit(admin, {
        tenant_id: tenantId, event_type: "qbo_project_verified",
        project_id: projectId, qbo_connection_id: connId, actor_user_id: userId,
        metadata: { trigger, correlation_id: correlationId, qbo_customer_id: qboCustomerId, intuit_tid: vTid },
      });
    }
  } catch (_e) { /* verification is best-effort */ }

  const finalReadiness = oldReadiness === "pending_classification" || oldReadiness === "needs_mapping"
    ? oldReadiness
    : "ready";
  await setReadiness(admin, projectId, project.current_accounting_snapshot_id, finalReadiness,
    tenantId, connId, userId, "qbo_sync_in_progress",
    { correlation_id: correlationId, qbo_customer_id: qboCustomerId });

  try {
    await admin.from("audit_log").insert({
      action: "qbo_project_sync.completed",
      resource_type: "project",
      resource_id: projectId,
      user_id: userId,
      metadata: {
        tenant_id: tenantId,
        qbo_connection_id: connId,
        qbo_customer_id: qboCustomerId,
        trigger,
        correlation_id: correlationId,
        intuit_tid: intuitTid,
        request_id: requestId,
      },
    });
  } catch (_e) { /* audit is best-effort */ }


  return json(200, {
    ok: true,
    data: {
      mapping_id: mappingId,
      qbo_customer_id: qboCustomerId,
      qbo_sync_token: syncToken,
      qbo_display_name: displayName,
      sync_status: "ready",
      accounting_readiness: finalReadiness,
    },
  }, requestId);
});
