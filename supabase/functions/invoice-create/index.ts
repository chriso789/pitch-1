// invoice-create
// Server-authoritative invoice creation. The browser never supplies tenant_id,
// company_id, pipeline_entries.tenant_id, or realm_id. Everything is resolved
// from the authenticated user + project record on the server.
//
// Auth model:
//   1) Validate JWT via anon client + Authorization header
//   2) Load project (pipeline_entries) with the service role -> authoritative tenant_id
//   3) Confirm the caller either:
//        a) has an active user_company_access row for that tenant, OR
//        b) is master AND has explicitly overridden into that tenant via
//           profiles.active_tenant_id === project.tenant_id
//      Master role alone does NOT grant write access — the impersonation
//      context must be present for THIS request. RLS is never widened.
//   4) Insert with service role (bypasses RLS) after all checks pass
//   5) Write an audit_log row with correlation id
//
// The get_user_tenant_ids() RLS primitive is intentionally NOT modified.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvoiceLineItem = {
  description: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
  trade_type?: string;
  trade_label?: string;
};

type PaymentOptions = {
  allowCreditCard?: boolean;
  allowAch?: boolean;
  requireDeposit?: boolean;
  autoEmailViaQbo?: boolean;
  sendFromPitchEmail?: boolean;
  createPortalLink?: boolean;
  terms?: "due_on_receipt" | "net_15" | "net_30" | "custom";
  customTerms?: string;
  customerMemo?: string;
  invoiceNumberOverride?: string;
};

type CreateInvoiceRequest = {
  project_id: string; // pipeline_entries.id — the only project identifier accepted
  invoice_type?: "standard" | "deposit" | "progress" | "final";
  due_date?: string | null;
  notes?: string | null;
  line_items: InvoiceLineItem[];
  cc_fee_amount?: number;
  cc_fee_percent?: number;
  payment_options?: PaymentOptions;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function badRequest(msg: string, details?: unknown) {
  return jsonResponse({ ok: false, error: msg, details }, 400);
}

function forbidden(msg: string) {
  return jsonResponse({ ok: false, error: msg }, 403);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const correlationId = crypto.randomUUID();

  try {
    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "Missing Authorization" }, 401);
    }

    // ---- 1) Authenticate ----
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, error: "Invalid or expired token" }, 401);
    }
    const userId = userData.user.id;

    // ---- 2) Parse + validate payload ----
    let body: CreateInvoiceRequest;
    try {
      body = (await req.json()) as CreateInvoiceRequest;
    } catch {
      return badRequest("Invalid JSON body");
    }

    // Strip any client-supplied identity fields (defense in depth).
    const forbiddenFields = [
      "tenant_id",
      "company_id",
      "realm_id",
      "qbo_connection_id",
      "pipeline_tenant",
      "project_tenant",
    ];
    for (const f of forbiddenFields) {
      if (Object.prototype.hasOwnProperty.call(body as any, f)) {
        delete (body as any)[f];
      }
    }

    const projectId = body.project_id;
    if (!projectId || typeof projectId !== "string") {
      return badRequest("project_id is required");
    }
    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
    if (lineItems.length === 0) {
      return badRequest("line_items must contain at least one entry");
    }
    for (const li of lineItems) {
      if (
        typeof li.description !== "string" ||
        typeof li.qty !== "number" ||
        typeof li.unit_cost !== "number" ||
        typeof li.line_total !== "number"
      ) {
        return badRequest("line_items entries must have description, qty, unit_cost, line_total");
      }
      if (li.line_total < 0) return badRequest("line_total must be >= 0");
    }

    const subtotal =
      Math.round(lineItems.reduce((s, li) => s + Number(li.line_total || 0), 0) * 100) / 100;
    const ccFeeAmount = Math.max(0, Number(body.cc_fee_amount || 0));
    const ccFeePercent = Math.max(0, Number(body.cc_fee_percent || 0));
    const amount = Math.round((subtotal) * 100) / 100;
    if (amount <= 0) return badRequest("Invoice total must be greater than zero");

    // ---- 3) Resolve authoritative tenant from project ----
    const service = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: project, error: projErr } = await service
      .from("pipeline_entries")
      .select("id, tenant_id")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) {
      console.error(`[invoice-create ${correlationId}] project lookup error`, projErr);
      return jsonResponse({ ok: false, error: "Project lookup failed" }, 500);
    }
    if (!project || !project.tenant_id) {
      return badRequest("Project not found");
    }
    const projectTenantId: string = project.tenant_id;

    // ---- 4) Verify caller's access to that tenant ----
    // (a) direct membership via user_company_access / profile
    const [{ data: profile }, { data: accessRows }, { data: masterRow }] = await Promise.all([
      service.from("profiles").select("tenant_id, active_tenant_id").eq("id", userId).maybeSingle(),
      service.from("user_company_access").select("tenant_id").eq("user_id", userId),
      service.from("user_roles").select("role").eq("user_id", userId).eq("role", "master").maybeSingle(),
    ]);

    const memberTenants = new Set<string>([
      ...(profile?.tenant_id ? [profile.tenant_id] : []),
      ...((accessRows ?? []).map((r: any) => r.tenant_id).filter(Boolean)),
    ]);
    const isMaster = !!masterRow;
    const activeOverride = profile?.active_tenant_id ?? null;

    const directMember = memberTenants.has(projectTenantId);
    // Master impersonation is only valid when the master has explicitly
    // switched their active_tenant_id to the project's tenant for this session.
    const masterImpersonating = isMaster && activeOverride === projectTenantId;

    if (!directMember && !masterImpersonating) {
      console.warn(
        `[invoice-create ${correlationId}] tenant access denied user=${userId} project=${projectId} tenant=${projectTenantId} master=${isMaster} activeOverride=${activeOverride}`,
      );
      return forbidden("You do not have access to this project's tenant");
    }

    // ---- 5) Build invoice_number if not overridden ----
    let invoiceNumber = body.payment_options?.invoiceNumberOverride?.trim() || "";
    if (!invoiceNumber) {
      const { count } = await service
        .from("project_invoices")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_entry_id", projectId);
      const n = (count ?? 0) + 1;
      invoiceNumber = `INV-${projectId.slice(0, 6).toUpperCase()}-${String(n).padStart(3, "0")}`;
    }

    // Fold payment_options into notes/metadata so nothing is silently dropped.
    // (Dedicated columns can be added later — keeping schema unchanged for now.)
    const opts = body.payment_options ?? {};
    const metaLines: string[] = [];
    if (opts.terms) metaLines.push(`Terms: ${opts.terms}${opts.terms === "custom" && opts.customTerms ? ` (${opts.customTerms})` : ""}`);
    if (opts.customerMemo) metaLines.push(`Customer Memo: ${opts.customerMemo}`);
    if (opts.allowCreditCard !== undefined) metaLines.push(`Allow CC: ${opts.allowCreditCard ? "yes" : "no"}`);
    if (opts.allowAch !== undefined) metaLines.push(`Allow ACH: ${opts.allowAch ? "yes" : "no"}`);
    if (opts.requireDeposit) metaLines.push(`Require Deposit: yes`);
    if (opts.autoEmailViaQbo) metaLines.push(`Auto Email via QBO: yes`);
    if (opts.sendFromPitchEmail) metaLines.push(`Send from Pitch: yes`);
    if (opts.createPortalLink) metaLines.push(`Create Portal Link: yes`);
    const composedNotes =
      [body.notes?.trim(), metaLines.join("\n")].filter(Boolean).join("\n\n").trim() || null;

    // ---- 6) Insert with service role ----
    const { data: inserted, error: insertErr } = await service
      .from("project_invoices")
      .insert({
        tenant_id: projectTenantId, // server-resolved, NOT from client
        pipeline_entry_id: projectId,
        invoice_number: invoiceNumber,
        amount,
        balance: amount,
        status: "draft",
        due_date: body.due_date || null,
        notes: composedNotes,
        created_by: userId,
        line_items: lineItems as any,
        cc_fee_amount: ccFeeAmount,
        cc_fee_percent: ccFeePercent,
      })
      .select()
      .single();

    if (insertErr || !inserted) {
      console.error(`[invoice-create ${correlationId}] insert failed`, insertErr);
      return jsonResponse(
        { ok: false, error: insertErr?.message || "Failed to create invoice", correlationId },
        500,
      );
    }

    // ---- 7) Audit ----
    try {
      await service.from("audit_log").insert({
        tenant_id: projectTenantId,
        table_name: "project_invoices",
        record_id: inserted.id,
        action: "invoice.create",
        new_values: {
          correlation_id: correlationId,
          project_id: projectId,
          invoice_number: invoiceNumber,
          amount,
          authenticated_user: userId,
          effective_tenant: projectTenantId,
          impersonated_tenant: masterImpersonating ? projectTenantId : null,
          via_master_impersonation: masterImpersonating,
          invoice_type: body.invoice_type ?? "standard",
        } as any,
        changed_by: userId,
      });
    } catch (auditErr) {
      // Never fail the request on audit-write issues, but log loudly.
      console.error(`[invoice-create ${correlationId}] audit_log insert failed`, auditErr);
    }

    return jsonResponse({
      ok: true,
      invoice: inserted,
      correlationId,
      effectiveTenantId: projectTenantId,
      viaMasterImpersonation: masterImpersonating,
    });
  } catch (err: any) {
    console.error(`[invoice-create ${correlationId}] unhandled`, err);
    return jsonResponse(
      { ok: false, error: err?.message || "Internal error", correlationId },
      500,
    );
  }
});
