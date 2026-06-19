// Create a supplier bill (and lines) from a supplier_invoice extraction.
// Re-runs the planner inline and enforces blocking flags.
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTenantAccess } from "../_shared/document-crm-match.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const extractionId: string = body?.extraction_id;
    const approve: boolean = !!body?.approve;
    const approveDuplicate: boolean = !!body?.approve_duplicate_override;
    const selectedIdx: number[] | undefined = Array.isArray(body?.selected_line_indexes)
      ? body.selected_line_indexes.map(Number)
      : undefined;
    const linkTarget = body?.link_target ?? {};
    if (!extractionId) return json({ ok: false, error: "missing extraction_id" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*")
      .eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);
    const allowed = await resolveTenantAccess(admin, u.user.id, ex.tenant_id);
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    // Re-plan via internal HTTP call so logic stays in one place.
    const planResp = await fetch(`${SUPABASE_URL}/functions/v1/plan-supplier-bill-from-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ extraction_id: extractionId }),
    });
    const plan = await planResp.json();
    if (!plan?.ok) return json({ ok: false, error: plan?.error ?? "plan_failed" }, 400);

    const blocking: string[] = plan.blocking_reasons ?? [];
    const onlyDuplicate = blocking.length === 1 && blocking[0] === "duplicate_invoice";

    if (blocking.length && !(onlyDuplicate && approveDuplicate)) {
      return json({ ok: false, error: "blocked_by_validation", blocking_reasons: blocking, plan }, 409);
    }

    const sb = plan.suggested_bill ?? {};
    const insertBill: Record<string, unknown> = {
      tenant_id: ex.tenant_id,
      document_id: ex.document_id,
      extraction_id: ex.id,
      pipeline_entry_id: linkTarget.pipeline_entry_id ?? sb.pipeline_entry_id ?? null,
      job_id: linkTarget.job_id ?? sb.job_id ?? null,
      contact_id: linkTarget.contact_id ?? sb.contact_id ?? null,
      supplier_name: sb.supplier_name,
      supplier_account_number: sb.supplier_account_number,
      invoice_number: sb.invoice_number,
      invoice_date: sb.invoice_date,
      due_date: sb.due_date,
      job_name: sb.job_name,
      job_address: sb.job_address,
      subtotal: sb.subtotal,
      tax: sb.tax,
      total: sb.total,
      balance_due: sb.balance_due,
      source: "document_extraction",
      created_by: u.user.id,
      review_status: approve && !blocking.length ? "approved" : "needs_review",
      status: approve && !blocking.length ? "approved" : "draft",
      approved_by: approve && !blocking.length ? u.user.id : null,
      approved_at: approve && !blocking.length ? new Date().toISOString() : null,
      metadata: {
        validation_flags: plan.validation_flags,
        duplicate_candidates: plan.duplicate_candidates,
        approved_duplicate_override: onlyDuplicate && approveDuplicate ? true : false,
      },
    };

    // If duplicate override, mark duplicate_of to the first candidate.
    if (onlyDuplicate && approveDuplicate && plan.duplicate_candidates?.length) {
      insertBill.duplicate_of = plan.duplicate_candidates[0].id;
      insertBill.review_status = "duplicate";
    }

    const { data: bill, error: billErr } = await admin.from("supplier_bills")
      .insert(insertBill).select("*").single();
    if (billErr) return json({ ok: false, error: billErr.message }, 500);

    const lines = (plan.suggested_lines ?? []).filter((_l: any, i: number) =>
      !selectedIdx || selectedIdx.includes(i)
    );
    if (lines.length) {
      const rows = lines.map((l: any) => ({
        tenant_id: ex.tenant_id,
        supplier_bill_id: bill.id,
        line_number: l.line_number,
        sku: l.sku,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        total_price: l.total_price,
        material_category: l.material_category,
        confidence: l.confidence,
      }));
      const { error: linesErr } = await admin.from("supplier_bill_lines").insert(rows);
      if (linesErr) {
        // Roll back the bill on line failure to avoid orphans
        await admin.from("supplier_bills").delete().eq("id", bill.id);
        return json({ ok: false, error: linesErr.message }, 500);
      }
    }

    // Audit events
    const events: Array<{ action_key: string; new_value: Record<string, unknown> }> = [
      { action_key: "bill_created", new_value: { bill_id: bill.id } },
      { action_key: "bill_lines_created", new_value: { bill_id: bill.id, count: lines.length } },
    ];
    if (insertBill.duplicate_of) events.push({ action_key: "duplicate_detected", new_value: { bill_id: bill.id, duplicate_of: insertBill.duplicate_of } });
    if (insertBill.pipeline_entry_id || insertBill.job_id) {
      events.push({ action_key: "linked_to_job", new_value: { bill_id: bill.id, pipeline_entry_id: insertBill.pipeline_entry_id, job_id: insertBill.job_id } });
    }
    for (const e of events) {
      await admin.from("ai_document_workflow_events").insert({
        tenant_id: ex.tenant_id,
        extraction_id: ex.id,
        document_id: ex.document_id,
        workflow_type: "supplier_invoice",
        action_key: e.action_key,
        target_table: "supplier_bills",
        target_id: bill.id,
        status: "applied",
        new_value: e.new_value,
        executed_by: u.user.id,
        executed_at: new Date().toISOString(),
      });
    }

    // Persist bill id in extraction workflow_metadata
    const wm = (ex.workflow_metadata ?? {}) as Record<string, unknown>;
    await admin.from("ai_document_extractions").update({
      workflow_metadata: { ...wm, supplier_bill_id: bill.id },
    }).eq("id", ex.id);

    return json({ ok: true, bill, line_count: lines.length });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
