// Plan supplier bill from a supplier_invoice extraction.
// Read-only: returns suggested bill + lines, duplicate candidates, validation flags.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveTenantAccess,
  normalizeAddress,
  normalizeName,
} from "../_shared/document-crm-match.ts";

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

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function inferCategory(text: string | null | undefined): string {
  const s = String(text ?? "").toLowerCase();
  if (!s) return "other";
  if (/shingle|gaf|owens|certainteed|tamko|malarkey/.test(s)) return "shingles";
  if (/underlay|synthetic felt|felt\b|ice.?and.?water|i&w/.test(s)) return "underlayment";
  if (/metal panel|standing seam|sheet metal|coil|aluminum coil/.test(s)) return "metal";
  if (/\btile\b|clay tile|concrete tile/.test(s)) return "tile";
  if (/nail|screw|fastener|cap nail|staple/.test(s)) return "fasteners";
  if (/vent|ridge vent|off ridge|turbine|exhaust/.test(s)) return "vents";
  if (/drip edge|d-?style|t-?style/.test(s)) return "drip_edge";
  if (/flashing|step flash|pipe boot|pipe jack|valley metal/.test(s)) return "flashing";
  if (/gutter|downspout|fascia|soffit/.test(s)) return "gutters";
  if (/caulk|sealant|cement|adhesive|accessor/.test(s)) return "accessories";
  if (/delivery|freight|shipping|handling/.test(s)) return "delivery";
  if (/labor|install/.test(s)) return "labor";
  return "other";
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
    if (!extractionId) return json({ ok: false, error: "missing extraction_id" }, 400);

    const { data: ex } = await admin.from("ai_document_extractions").select("*")
      .eq("id", extractionId).maybeSingle();
    if (!ex) return json({ ok: false, error: "extraction_not_found" }, 404);
    const allowed = await resolveTenantAccess(admin, u.user.id, ex.tenant_id);
    if (!allowed) return json({ ok: false, error: "tenant access denied" }, 403);

    const blocking: string[] = [];
    const flags: Array<{ code: string; severity: "info" | "warning" | "error" | "blocking"; message?: string }> = [];

    if (String(ex.document_class) !== "supplier_invoice") {
      blocking.push("document_class_not_supplier_invoice");
    }
    if (!["completed", "needs_review", "approved"].includes(String(ex.extraction_status))) {
      blocking.push("extraction_not_ready");
    }

    const n = ex.normalized_fields ?? {};
    const supplier_name = (n.supplier_name ?? n.vendor_name ?? null) as string | null;
    const invoice_number = (n.invoice_number ?? null) as string | null;
    const invoice_date = toDate(n.invoice_date);
    const due_date = toDate(n.due_date);
    const account_number = (n.account_number ?? n.supplier_account_number ?? null) as string | null;
    const job_name = (n.job_name ?? null) as string | null;
    const job_address = (n.job_address ?? n.property_address ?? null) as string | null;
    const customer_name = (n.customer_name ?? null) as string | null;
    const subtotal = toNumber(n.subtotal);
    const tax = toNumber(n.tax);
    const total = toNumber(n.total ?? n.amount_due);
    const balance_due = toNumber(n.balance_due);
    const raw_lines: any[] = Array.isArray(n.line_items) ? n.line_items : [];

    const suggested_lines = raw_lines.map((li, i) => {
      const qty = toNumber(li.quantity ?? li.qty);
      const unit_price = toNumber(li.unit_price ?? li.price);
      const total_price = toNumber(li.total_price ?? li.line_total ?? li.amount) ??
        (qty != null && unit_price != null ? Math.round(qty * unit_price * 100) / 100 : null);
      const desc = (li.description ?? li.name ?? null) as string | null;
      const sku = (li.sku ?? li.item_number ?? null) as string | null;
      return {
        line_number: i + 1,
        sku,
        description: desc,
        quantity: qty,
        unit: (li.unit ?? li.uom ?? null) as string | null,
        unit_price,
        total_price,
        material_category: inferCategory(`${desc ?? ""} ${sku ?? ""}`),
        confidence: toNumber(li.confidence),
      };
    });

    // Validation
    if (!supplier_name) { flags.push({ code: "missing_supplier_name", severity: "blocking" }); blocking.push("missing_supplier_name"); }
    if (!invoice_number) flags.push({ code: "missing_invoice_number", severity: "warning" });
    if (total == null) { flags.push({ code: "missing_total", severity: "blocking" }); blocking.push("missing_total"); }
    if (total != null && total < 0) flags.push({ code: "negative_total", severity: "warning" });
    if (subtotal != null && tax != null && total != null) {
      const diff = Math.abs(subtotal + tax - total);
      if (diff > 0.05) flags.push({ code: "total_mismatch", severity: "warning", message: `subtotal+tax=${(subtotal + tax).toFixed(2)} vs total=${total.toFixed(2)}` });
    }
    if (invoice_date && new Date(invoice_date) > new Date()) {
      flags.push({ code: "invoice_date_future", severity: "warning" });
    }
    if (suggested_lines.length) {
      const sum = suggested_lines.reduce((acc, l) => acc + (l.total_price ?? 0), 0);
      if (total != null && Math.abs(sum - total) > Math.max(1, total * 0.02)) {
        flags.push({ code: "line_items_total_mismatch", severity: "warning", message: `lines=${sum.toFixed(2)} vs total=${total.toFixed(2)}` });
      }
    }
    if (Number(ex.confidence ?? 0) < 0.85) {
      flags.push({ code: "extraction_confidence_low", severity: "info" });
    }

    // Link match
    let pipeline_entry_id: string | null = ex.pipeline_entry_id ?? null;
    let job_id: string | null = ex.job_id ?? null;
    let contact_id: string | null = ex.contact_id ?? null;

    if (!pipeline_entry_id && !job_id) {
      const addrQ = normalizeAddress(job_address);
      if (addrQ) {
        const first = addrQ.split(" ").slice(0, 2).join(" ");
        if (first) {
          const { data: pes } = await admin.from("pipeline_entries")
            .select("id, contact_id, contacts:contacts!pipeline_entries_contact_id_fkey(id,address_street)")
            .eq("tenant_id", ex.tenant_id).limit(20);
          const match = (pes ?? []).find((pe: any) => {
            const a = normalizeAddress(pe.contacts?.address_street);
            return a && (a === addrQ || a.startsWith(first));
          });
          if (match) {
            pipeline_entry_id = match.id;
            contact_id = contact_id ?? match.contact_id ?? null;
          }
        }
      }
    }
    if (!contact_id && customer_name) {
      const nm = normalizeName(customer_name);
      const last = nm?.split(" ").slice(-1)[0];
      if (last && last.length > 1) {
        const { data: cs } = await admin.from("contacts")
          .select("id,first_name,last_name").eq("tenant_id", ex.tenant_id)
          .ilike("last_name", `%${last}%`).limit(5);
        if (cs?.length === 1) contact_id = cs[0].id;
      }
    }
    if (!pipeline_entry_id && !job_id && !contact_id) {
      flags.push({ code: "unlinked_job", severity: "warning" });
    }

    // Duplicate detection
    const dupQ = admin.from("supplier_bills").select("id,supplier_name,invoice_number,total,invoice_date,document_id,extraction_id,duplicate_of")
      .eq("tenant_id", ex.tenant_id).is("duplicate_of", null).limit(20);
    if (supplier_name) dupQ.ilike("supplier_name", supplier_name);
    const { data: dupRows } = await dupQ;
    const duplicate_candidates: any[] = [];
    for (const d of dupRows ?? []) {
      const reasons: string[] = [];
      if (invoice_number && d.invoice_number && String(d.invoice_number).trim() === String(invoice_number).trim()) reasons.push("same_invoice_number");
      if (d.document_id && d.document_id === ex.document_id) reasons.push("same_document");
      if (d.extraction_id && d.extraction_id === ex.id) reasons.push("same_extraction");
      if (total != null && d.total != null && Math.abs(Number(d.total) - total) < 0.01 && invoice_date && d.invoice_date) {
        const diffDays = Math.abs((new Date(invoice_date).getTime() - new Date(d.invoice_date).getTime()) / 86400000);
        if (diffDays <= 3) reasons.push("same_total_and_date");
      }
      if (reasons.length) duplicate_candidates.push({ id: d.id, reasons });
    }
    if (duplicate_candidates.some((d) => d.reasons.includes("same_invoice_number"))) {
      flags.push({ code: "duplicate_invoice", severity: "blocking" });
      blocking.push("duplicate_invoice");
    }

    const readiness = blocking.length ? "blocked" : flags.some((f) => f.severity === "warning") ? "needs_review" : "ready";

    return json({
      ok: true,
      readiness,
      blocking_reasons: blocking,
      validation_flags: flags,
      duplicate_candidates,
      suggested_bill: {
        tenant_id: ex.tenant_id,
        document_id: ex.document_id,
        extraction_id: ex.id,
        pipeline_entry_id,
        job_id,
        contact_id,
        supplier_name,
        supplier_account_number: account_number,
        invoice_number,
        invoice_date,
        due_date,
        job_name,
        job_address,
        subtotal,
        tax,
        total,
        balance_due,
      },
      suggested_lines,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
