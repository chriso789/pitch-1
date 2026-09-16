// Archives the original material + labor orders as PDFs in the project's
// documents when a lead is converted to a project. Tenant-agnostic: called
// for every tenant from api-approve-job-from-lead.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Row = Record<string, any>;

const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function isLabor(r: Row) {
  return (r.item_category || "").toLowerCase().includes("labor");
}
function isMaterial(r: Row) {
  const cat = (r.item_category || "").toLowerCase();
  return cat.includes("material") || (!isLabor(r) && (r.srs_item_code || r.abc_item_number));
}

async function buildOrderPdf(opts: {
  title: string;
  accent: [number, number, number];
  company: Row | null;
  customerName: string;
  projectAddress: string;
  jobNumber: string;
  estimateLabel: string;
  items: Row[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = [612, 792];
  const margin = 40;
  const accent = rgb(opts.accent[0] / 255, opts.accent[1] / 255, opts.accent[2] / 255);
  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);

  let page = pdf.addPage([pw, ph]);
  let y = ph - margin;

  const newPage = () => {
    page = pdf.addPage([pw, ph]);
    y = ph - margin;
  };
  const text = (s: string, x: number, size = 9, f = font, color = ink) =>
    page.drawText(s ?? "", { x, y, size, font: f, color });

  // Company header
  text(opts.company?.name || "Company", margin, 15, bold);
  y -= 14;
  const contact = [opts.company?.phone, opts.company?.email].filter(Boolean).join("  •  ");
  if (contact) { text(contact, margin, 9, font, muted); y -= 11; }
  if (opts.company?.license_number) { text(`License #${opts.company.license_number}`, margin, 9, font, muted); y -= 11; }
  y -= 8;

  // Title banner
  page.drawRectangle({ x: margin, y: y - 22, width: pw - margin * 2, height: 24, color: accent });
  page.drawText(opts.title, { x: margin + 8, y: y - 15, size: 13, font: bold, color: rgb(1, 1, 1) });
  y -= 38;

  const metaLines = [
    opts.jobNumber ? `Job: ${opts.jobNumber}` : "",
    opts.customerName ? `Customer: ${opts.customerName}` : "",
    opts.projectAddress ? `Address: ${opts.projectAddress}` : "",
    opts.estimateLabel ? `Estimate: ${opts.estimateLabel}` : "",
    `Archived: ${new Date().toLocaleDateString("en-US")} (original order at conversion)`,
  ].filter(Boolean);
  for (const line of metaLines) { text(line, margin, 9, font, muted); y -= 12; }
  y -= 8;

  // Table header
  const cols = [margin, margin + 250, margin + 320, margin + 400, margin + 480];
  page.drawLine({ start: { x: margin, y: y + 12 }, end: { x: pw - margin, y: y + 12 }, color: accent, thickness: 1 });
  text("ITEM", cols[0], 8, bold);
  text("QTY", cols[1], 8, bold);
  text("UNIT", cols[2], 8, bold);
  text("UNIT COST", cols[3], 8, bold);
  text("TOTAL", cols[4], 8, bold);
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pw - margin, y }, color: rgb(0.9, 0.9, 0.92), thickness: 0.5 });
  y -= 14;

  let total = 0;
  for (const it of opts.items) {
    if (y < margin + 80) { newPage(); }
    const qty = Number(it.quantity || 0);
    const cost = Number(it.unit_cost || 0);
    const line = Number(it.extended_cost ?? qty * cost);
    total += line;
    const name = String(it.item_name || it.description || "Item").slice(0, 52);
    text(name, cols[0], 9);
    text(qty.toLocaleString("en-US", { maximumFractionDigits: 2 }), cols[1], 9);
    text(String(it.unit_type || "EA"), cols[2], 9);
    text(money(cost), cols[3], 9);
    text(money(line), cols[4], 9);
    y -= 12;
    const specs = [it.abc_color, it.notes].filter(Boolean).join(" • ");
    if (specs) { text(String(specs).slice(0, 80), cols[0] + 8, 8, font, muted); y -= 11; }
  }

  if (y < margin + 50) newPage();
  y -= 6;
  page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: pw - margin, y: y + 8 }, color: accent, thickness: 1 });
  text("ORDER TOTAL", cols[3] - 60, 10, bold);
  text(money(total), cols[4], 10, bold);

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(supabaseUrl, serviceKey);
  try {
    const body = await req.json();
    const { tenantId, pipelineEntryId, projectId, estimateIds, userId } = body ?? {};
    if (!tenantId || !pipelineEntryId) {
      return new Response(JSON.stringify({ error: "tenantId and pipelineEntryId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve which estimates make up the converted contract
    let ids: string[] = Array.isArray(estimateIds) ? estimateIds.filter((v: unknown) => typeof v === "string") : [];
    const { data: estimates } = await supabase
      .from("enhanced_estimates")
      .select("id, estimate_number, selling_price, pipeline_entry_id, project_id")
      .eq("tenant_id", tenantId)
      .or([`pipeline_entry_id.eq.${pipelineEntryId}`, projectId ? `project_id.eq.${projectId}` : null]
        .filter(Boolean)
        .join(","));
    const all = estimates ?? [];
    if (ids.length === 0) {
      const best = [...all].sort((a, b) => Number(b.selling_price ?? 0) - Number(a.selling_price ?? 0))[0];
      if (best) ids = [best.id];
    }
    if (ids.length === 0) {
      return new Response(JSON.stringify({ archived: [], reason: "no_estimates" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lineItems } = await supabase
      .from("estimate_line_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("estimate_id", ids)
      .order("sort_order", { ascending: true });

    const rows = lineItems ?? [];
    const materials = rows.filter(isMaterial);
    const labor = rows.filter(isLabor);

    const [{ data: tenant }, { data: entry }] = await Promise.all([
      supabase.from("tenants").select("name, phone, email, license_number").eq("id", tenantId).maybeSingle(),
      supabase
        .from("pipeline_entries")
        .select("clj_formatted_number, contacts(first_name, last_name, address_street, address_city, address_state, address_zip)")
        .eq("id", pipelineEntryId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    const c: any = (entry as any)?.contacts ?? {};
    const customerName = [c.first_name, c.last_name].filter(Boolean).join(" ");
    const projectAddress = [c.address_street, c.address_city, c.address_state, c.address_zip].filter(Boolean).join(", ");
    const estimateLabel = all
      .filter((e) => ids.includes(e.id))
      .map((e) => e.estimate_number)
      .filter(Boolean)
      .join(" + ");
    const jobNumber = (entry as any)?.clj_formatted_number ?? "";

    const stamp = new Date().toISOString().slice(0, 10);
    const archived: string[] = [];

    const jobs: Array<{ kind: "material" | "labor"; title: string; accent: [number, number, number]; items: Row[] }> = [
      { kind: "material", title: "ORIGINAL MATERIAL ORDER", accent: [59, 130, 246], items: materials },
      { kind: "labor", title: "ORIGINAL LABOR ORDER", accent: [15, 118, 110], items: labor },
    ];

    for (const job of jobs) {
      if (job.items.length === 0) continue;
      const bytes = await buildOrderPdf({
        title: job.title,
        accent: job.accent,
        company: tenant ?? null,
        customerName,
        projectAddress,
        jobNumber,
        estimateLabel,
        items: job.items,
      });
      const filename = `original-${job.kind}-order-${stamp}.pdf`;
      const path = `${tenantId}/${pipelineEntryId}/orders/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (uploadError) {
        console.error("[archive-conversion-orders] upload failed", job.kind, uploadError);
        continue;
      }

      // Idempotent: one archived order document per kind per pipeline entry
      const docType = job.kind === "material" ? "original_material_order" : "original_labor_order";
      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("pipeline_entry_id", pipelineEntryId)
        .eq("document_type", docType)
        .maybeSingle();

      const record = {
        tenant_id: tenantId,
        pipeline_entry_id: pipelineEntryId,
        project_id: projectId ?? null,
        document_type: docType,
        filename,
        file_path: path,
        file_size: bytes.byteLength,
        mime_type: "application/pdf",
        description: `${job.kind === "material" ? "Material" : "Labor"} order as of lead → project conversion${estimateLabel ? ` (${estimateLabel})` : ""}`,
        uploaded_by: userId ?? null,
        service_address: projectAddress || null,
        metadata: { source: "lead_conversion", estimate_ids: ids, item_count: job.items.length },
      };

      if (existing?.id) {
        await supabase.from("documents").update(record).eq("id", existing.id);
      } else {
        const { error: docError } = await supabase.from("documents").insert(record);
        if (docError) {
          console.error("[archive-conversion-orders] document insert failed", job.kind, docError);
          continue;
        }
      }
      archived.push(docType);
    }

    return new Response(JSON.stringify({ archived, estimate_ids: ids }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[archive-conversion-orders] error", err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
