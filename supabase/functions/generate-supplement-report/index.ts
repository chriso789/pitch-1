import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

interface Body {
  comparison_id: string;
}

const fmtMoney = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const CHANGE_LABEL: Record<string, string> = {
  added: 'Added by Company',
  removed: 'Removed by Company',
  qty_change: 'Quantity Change',
  price_change: 'Price Change',
  unchanged: 'Unchanged',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    const body = (await req.json()) as Body;
    if (!body?.comparison_id) {
      return new Response(JSON.stringify({ error: 'comparison_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load comparison + lines + docs
    const { data: comparison, error: cmpErr } = await admin
      .from('scope_comparisons')
      .select('*')
      .eq('id', body.comparison_id)
      .single();
    if (cmpErr || !comparison) throw new Error(cmpErr?.message ?? 'Comparison not found');

    const { data: lines, error: linesErr } = await admin
      .from('scope_comparison_lines')
      .select('*')
      .eq('comparison_id', comparison.id)
      .order('change_type');
    if (linesErr) throw new Error(linesErr.message);

    const { data: docs } = await admin
      .from('insurance_scope_documents')
      .select('id, file_name, carrier_normalized, claim_number, adjuster_name, property_address, document_type')
      .in('id', [comparison.carrier_document_id, comparison.company_document_id]);

    const carrierDoc = docs?.find((d) => d.id === comparison.carrier_document_id);
    const companyDoc = docs?.find((d) => d.id === comparison.company_document_id);

    // Build PDF
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN = 48;
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const newPage = () => {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    };

    const ensureSpace = (h: number) => {
      if (y - h < MARGIN) newPage();
    };

    const drawText = (
      text: string,
      opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number } = {}
    ) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? bold : font;
      const c = opts.color ?? [0.1, 0.1, 0.15];
      ensureSpace(size + 4);
      page.drawText(text, {
        x: opts.x ?? MARGIN,
        y: y - size,
        size,
        font: f,
        color: rgb(c[0], c[1], c[2]),
      });
      y -= size + 4;
    };

    const drawDivider = () => {
      ensureSpace(10);
      page.drawLine({
        start: { x: MARGIN, y: y - 4 },
        end: { x: PAGE_W - MARGIN, y: y - 4 },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.75),
      });
      y -= 10;
    };

    const wrap = (text: string, size: number, maxW: number, f = font): string[] => {
      if (!text) return [''];
      const words = String(text).split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW && cur) {
          lines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    // ===== Cover =====
    drawText('Insurance Supplement Report', { size: 22, bold: true });
    y -= 6;
    drawText(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
      size: 10,
      color: [0.4, 0.4, 0.45],
    });
    drawDivider();

    drawText('Carrier Information', { size: 13, bold: true });
    drawText(`Carrier: ${carrierDoc?.carrier_normalized ?? '—'}`);
    drawText(`Claim #: ${carrierDoc?.claim_number ?? '—'}`);
    drawText(`Adjuster: ${carrierDoc?.adjuster_name ?? '—'}`);
    drawText(`Property: ${carrierDoc?.property_address ?? '—'}`);
    drawText(`Carrier Estimate: ${carrierDoc?.file_name ?? '—'}`);
    drawText(`Company Estimate: ${companyDoc?.file_name ?? '—'}`);
    y -= 8;

    drawText('Executive Summary', { size: 13, bold: true });
    drawText(`Carrier RCV Total: ${fmtMoney(comparison.carrier_total_rcv)}`);
    drawText(`Company RCV Total: ${fmtMoney(comparison.company_total_rcv)}`);
    drawText(`Net Supplement Requested: ${fmtMoney(comparison.net_supplement_amount)}`, { bold: true });
    y -= 4;
    drawText(`Lines Added by Company: ${comparison.added_count ?? 0}`);
    drawText(`Lines Removed by Company: ${comparison.removed_count ?? 0}`);
    drawText(`Quantity Adjustments: ${comparison.qty_change_count ?? 0}`);
    drawText(`Price Adjustments: ${comparison.price_change_count ?? 0}`);
    drawDivider();

    // ===== Line-by-line =====
    drawText('Line-by-Line Differences', { size: 13, bold: true });
    y -= 4;

    const groups: Record<string, typeof lines> = {
      added: [],
      qty_change: [],
      price_change: [],
      removed: [],
    };
    for (const l of lines ?? []) {
      if (l.change_type !== 'unchanged' && groups[l.change_type]) groups[l.change_type].push(l);
    }

    const drawLine = (l: any) => {
      ensureSpace(80);
      const startY = y;
      // Header strip
      page.drawRectangle({
        x: MARGIN,
        y: y - 14,
        width: PAGE_W - MARGIN * 2,
        height: 14,
        color: rgb(0.93, 0.95, 0.98),
      });
      drawText(`${CHANGE_LABEL[l.change_type] ?? l.change_type}  •  ${l.category ?? 'Uncategorized'}`, {
        size: 9,
        bold: true,
        color: [0.15, 0.3, 0.55],
      });

      const code = l.company_code || l.carrier_code || '—';
      const desc = l.company_description || l.carrier_description || '—';
      drawText(`${code}  ${desc}`, { size: 10, bold: true });

      // Two-column carrier vs company
      const colW = (PAGE_W - MARGIN * 2 - 10) / 2;
      const leftX = MARGIN;
      const rightX = MARGIN + colW + 10;
      const rowY = y;

      const block = (label: string, qty: any, unit: any, price: any, total: any, x: number) => {
        let yy = rowY;
        page.drawText(label, { x, y: yy - 9, size: 8, font: bold, color: rgb(0.4, 0.4, 0.45) });
        yy -= 11;
        const txt = `Qty ${fmtQty(qty)} ${unit ?? ''}  @ ${fmtMoney(price)}  =  ${fmtMoney(total)}`;
        page.drawText(txt, { x, y: yy - 9, size: 9, font, color: rgb(0.1, 0.1, 0.15) });
      };
      block('CARRIER', l.carrier_quantity, l.carrier_unit, l.carrier_unit_price, l.carrier_total_rcv, leftX);
      block('COMPANY', l.company_quantity, l.company_unit, l.company_unit_price, l.company_total_rcv, rightX);
      y -= 24;

      const deltaTxt = `Δ Qty ${fmtQty(l.delta_quantity)}   Δ Unit ${fmtMoney(l.delta_unit_price)}   Δ RCV ${fmtMoney(l.delta_rcv)}`;
      drawText(deltaTxt, { size: 9, color: [0.55, 0.2, 0.2], bold: true });

      if (l.justification) {
        const wrapped = wrap(`Justification: ${l.justification}`, 9, PAGE_W - MARGIN * 2);
        for (const w of wrapped) drawText(w, { size: 9, color: [0.25, 0.25, 0.3] });
      }
      y -= 6;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.3,
        color: rgb(0.85, 0.85, 0.9),
      });
      y -= 8;
      void startY;
    };

    for (const key of ['added', 'qty_change', 'price_change', 'removed']) {
      const arr = groups[key];
      if (!arr.length) continue;
      ensureSpace(20);
      drawText(`${CHANGE_LABEL[key]} (${arr.length})`, { size: 11, bold: true, color: [0.15, 0.3, 0.55] });
      for (const l of arr) drawLine(l);
    }

    // ===== Signature =====
    ensureSpace(80);
    drawDivider();
    drawText('Adjuster Acknowledgement', { size: 12, bold: true });
    y -= 18;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 240, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    page.drawLine({ start: { x: MARGIN + 280, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    y -= 12;
    drawText('Adjuster Signature', { size: 8, color: [0.4, 0.4, 0.45] });
    page.drawText('Date', { x: MARGIN + 280, y: y + 4, size: 8, font, color: rgb(0.4, 0.4, 0.45) });

    const pdfBytes = await pdf.save();

    // Determine version
    const { data: existing } = await admin
      .from('supplement_reports')
      .select('version')
      .eq('comparison_id', comparison.id)
      .order('version', { ascending: false })
      .limit(1);
    const version = (existing?.[0]?.version ?? 0) + 1;

    const projectFolder = comparison.project_id ?? comparison.job_id ?? 'misc';
    const path = `${comparison.tenant_id}/projects/${projectFolder}/supplements/supplement-${comparison.id}-v${version}.pdf`;

    const { error: upErr } = await admin.storage
      .from('documents')
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: signed } = await admin.storage.from('documents').createSignedUrl(path, 60 * 60 * 24 * 7);

    const { data: report, error: insErr } = await admin
      .from('supplement_reports')
      .insert({
        tenant_id: comparison.tenant_id,
        comparison_id: comparison.id,
        version,
        pdf_url: signed?.signedUrl ?? null,
        pdf_storage_path: path,
        status: 'generated',
        created_by: userId,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    await admin.from('scope_comparisons').update({ status: 'ready' }).eq('id', comparison.id);

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('generate-supplement-report error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
