import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Body {
  comparison_id: string;
}

const fmtMoney = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const CHANGE_LABEL: Record<string, string> = {
  name_change: 'Line Item Name Difference',
  added: 'Added by Company',
  removed: 'Removed by Company',
  qty_change: 'Quantity Change',
  price_change: 'Price Change',
  unchanged: 'Unchanged',
};

const safePdfText = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[•·]/g, '-')
  .replace(/[Δ∆]/g, 'Delta')
  .replace(/[×✕]/g, 'x')
  .replace(/[–—]/g, '-')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/…/g, '...')
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

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
      .select('id, file_name, carrier_normalized, claim_number_detected, adjuster_name, document_type')
      .in('id', [comparison.carrier_document_id, comparison.company_document_id]);

    const carrierDoc = docs?.find((d) => d.id === comparison.carrier_document_id);
    const companyDoc = docs?.find((d) => d.id === comparison.company_document_id);

    // Load tenant (the company the report is being built for)
    const { data: tenant } = await admin
      .from('tenants')
      .select('name, logo_url, phone, email, address_street, address_city, address_state, address_zip, license_number, website, brand_primary_color')
      .eq('id', comparison.tenant_id)
      .single();

    // Build PDF
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN = 48;
    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    // Parse brand color
    const parseHex = (hex?: string | null): [number, number, number] => {
      if (!hex) return [0.12, 0.25, 0.55];
      const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
      if (!m) return [0.12, 0.25, 0.55];
      const v = m[1];
      return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
    };
    const brand = parseHex(tenant?.brand_primary_color);

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
      const safeText = safePdfText(text);
      const size = opts.size ?? 10;
      const f = opts.bold ? bold : font;
      const c = opts.color ?? [0.1, 0.1, 0.15];
      ensureSpace(size + 4);
      page.drawText(safeText, {
        x: opts.x ?? MARGIN,
        y: y - size,
        size,
        font: f,
        color: rgb(c[0], c[1], c[2]),
      });
      y -= size + 4;
    };
    const drawDivider = (color: [number, number, number] = [0.85, 0.85, 0.9]) => {
      ensureSpace(10);
      page.drawLine({
        start: { x: MARGIN, y: y - 4 },
        end: { x: PAGE_W - MARGIN, y: y - 4 },
        thickness: 0.5,
        color: rgb(color[0], color[1], color[2]),
      });
      y -= 10;
    };
    const wrap = (text: string, size: number, maxW: number, f = font): string[] => {
      const safeText = safePdfText(text);
      if (!safeText) return [''];
      const words = safeText.split(/\s+/);
      const out: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW && cur) {
          out.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) out.push(cur);
      return out;
    };

    // ===== Company Header Banner =====
    page.drawRectangle({
      x: 0,
      y: PAGE_H - 80,
      width: PAGE_W,
      height: 80,
      color: rgb(brand[0], brand[1], brand[2]),
    });

    // Try to embed logo
    let logoEmbedded = false;
    if (tenant?.logo_url) {
      try {
        const resp = await fetch(tenant.logo_url);
        if (resp.ok) {
          const bytes = new Uint8Array(await resp.arrayBuffer());
          const ct = resp.headers.get('content-type') ?? '';
          const img = ct.includes('png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          const h = 50;
          const w = (img.width / img.height) * h;
          page.drawImage(img, { x: MARGIN, y: PAGE_H - 65, width: w, height: h });
          logoEmbedded = true;
        }
      } catch (_) { /* ignore */ }
    }

    const headerTextX = logoEmbedded ? MARGIN + 130 : MARGIN;
    page.drawText(safePdfText(tenant?.name ?? 'Company'), {
      x: headerTextX, y: PAGE_H - 35, size: 18, font: bold, color: rgb(1, 1, 1),
    });
    const headerSub = [
      tenant?.address_street,
      [tenant?.address_city, tenant?.address_state, tenant?.address_zip].filter(Boolean).join(', '),
      tenant?.phone, tenant?.email, tenant?.license_number ? `License: ${tenant.license_number}` : null,
    ].filter(Boolean).join('  •  ');
    page.drawText(safePdfText(headerSub).slice(0, 110), {
      x: headerTextX, y: PAGE_H - 55, size: 8, font, color: rgb(0.92, 0.95, 1),
    });

    y = PAGE_H - 100;

    // ===== Title =====
    drawText('Insurance Supplement Report', { size: 20, bold: true });
    drawText(
      `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      { size: 9, color: [0.4, 0.4, 0.45] }
    );
    drawDivider(brand);

    // ===== Claim / Doc info =====
    drawText('Claim & Document Information', { size: 12, bold: true, color: brand });
    drawText(`Carrier: ${carrierDoc?.carrier_normalized ?? '—'}`);
    drawText(`Claim #: ${carrierDoc?.claim_number_detected ?? '—'}`);
    drawText(`Adjuster: ${carrierDoc?.adjuster_name ?? '—'}`);
    drawText(`Carrier Estimate: ${carrierDoc?.file_name ?? '—'}`);
    drawText(`Company Estimate: ${companyDoc?.file_name ?? '—'}`);
    y -= 6;

    // ===== Executive Summary =====
    drawText('Executive Summary', { size: 12, bold: true, color: brand });
    drawText(`Carrier RCV Total: ${fmtMoney(comparison.carrier_total_rcv)}`);
    drawText(`Company RCV Total: ${fmtMoney(comparison.company_total_rcv)}`);
    drawText(`Net Supplement Requested: ${fmtMoney(comparison.net_supplement_amount)}`, { bold: true });
    y -= 2;
    const nameChangeCount = (lines ?? []).filter((l: any) => l.change_type === 'name_change').length;
    drawText(`Name Diffs: ${nameChangeCount}   •   Added: ${comparison.added_count ?? 0}   •   Removed: ${comparison.removed_count ?? 0}   •   Qty Δ: ${comparison.qty_change_count ?? 0}   •   Price Δ: ${comparison.price_change_count ?? 0}`, { size: 9, color: [0.35, 0.35, 0.4] });
    drawDivider(brand);

    // ===== Line Item Name Differences (lead section) =====
    const nameDiffRows = (lines ?? []).filter((l: any) => l.change_type === 'name_change');
    if (nameDiffRows.length) {
      drawText('Line Item Name Differences', { size: 12, bold: true, color: brand });
      drawText('Same item, different wording between the carrier estimate and the company estimate.', { size: 8, color: [0.45, 0.45, 0.5] });
      y -= 4;
      const colHdrY = y;
      page.drawRectangle({ x: MARGIN, y: y - 12, width: PAGE_W - MARGIN * 2, height: 12, color: rgb(0.94, 0.96, 0.99) });
      page.drawText('CARRIER WORDING', { x: MARGIN + 4, y: y - 9, size: 8, font: bold, color: rgb(0.25, 0.3, 0.4) });
      page.drawText('COMPANY WORDING', { x: MARGIN + (PAGE_W - MARGIN * 2) / 2 + 4, y: y - 9, size: 8, font: bold, color: rgb(0.25, 0.3, 0.4) });
      y -= 14;
      const halfW = (PAGE_W - MARGIN * 2) / 2 - 6;
      for (const l of nameDiffRows) {
        const cLines = wrap(`${l.carrier_code || ''}  ${l.carrier_description || ''}`.trim(), 8, halfW);
        const yLines = wrap(`${l.company_code || ''}  ${l.company_description || ''}`.trim(), 8, halfW);
        const rowH = Math.max(cLines.length, yLines.length) * 10 + 6;
        ensureSpace(rowH);
        const yStart = y;
        for (let i = 0; i < cLines.length; i++) {
          page.drawText(safePdfText(cLines[i]), { x: MARGIN, y: yStart - 8 - i * 10, size: 8, font, color: rgb(0.15, 0.15, 0.2) });
        }
        for (let i = 0; i < yLines.length; i++) {
          page.drawText(safePdfText(yLines[i]), { x: MARGIN + (PAGE_W - MARGIN * 2) / 2 + 4, y: yStart - 8 - i * 10, size: 8, font, color: rgb(0.15, 0.15, 0.2) });
        }
        y -= rowH;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: rgb(0.88, 0.88, 0.92) });
        y -= 4;
      }
      drawDivider(brand);
    }


    // ===== Price List (first page) =====
    drawText('Price List Reference', { size: 12, bold: true, color: brand });
    drawText('Unit pricing used in this comparison (deduplicated by item code).', { size: 8, color: [0.45, 0.45, 0.5] });
    y -= 2;

    // Build price list from all lines (company price preferred, else carrier)
    type PriceRow = { code: string; desc: string; unit: string; price: number; source: string };
    const seen = new Map<string, PriceRow>();
    for (const l of lines ?? []) {
      const code = (l.company_code || l.carrier_code || '').trim();
      if (!code || seen.has(code)) continue;
      const price = Number(l.company_unit_price ?? l.carrier_unit_price ?? 0);
      seen.set(code, {
        code,
        desc: (l.company_description || l.carrier_description || '').slice(0, 60),
        unit: (l.company_unit || l.carrier_unit || '') as string,
        price,
        source: l.company_unit_price != null ? 'Company' : 'Carrier',
      });
    }
    const priceRows = Array.from(seen.values()).sort((a, b) => a.code.localeCompare(b.code));

    // Header row
    const colX = { code: MARGIN, desc: MARGIN + 80, unit: MARGIN + 330, price: MARGIN + 390, src: MARGIN + 460 };
    ensureSpace(14);
    page.drawRectangle({ x: MARGIN, y: y - 12, width: PAGE_W - MARGIN * 2, height: 12, color: rgb(0.94, 0.96, 0.99) });
    const drawHdr = (t: string, x: number) =>
      page.drawText(t, { x, y: y - 9, size: 8, font: bold, color: rgb(0.25, 0.3, 0.4) });
    drawHdr('CODE', colX.code); drawHdr('DESCRIPTION', colX.desc);
    drawHdr('UNIT', colX.unit); drawHdr('UNIT PRICE', colX.price); drawHdr('SOURCE', colX.src);
    y -= 14;

    for (const r of priceRows) {
      ensureSpace(12);
      page.drawText(safePdfText(r.code), { x: colX.code, y: y - 9, size: 8, font, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(safePdfText(r.desc), { x: colX.desc, y: y - 9, size: 8, font, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(safePdfText(r.unit ?? ''), { x: colX.unit, y: y - 9, size: 8, font, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(fmtMoney(r.price), { x: colX.price, y: y - 9, size: 8, font, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(safePdfText(r.source), { x: colX.src, y: y - 9, size: 8, font, color: rgb(0.4, 0.4, 0.45) });
      y -= 12;
    }
    drawDivider(brand);

    // ===== Full Line Items Table (ALL lines including unchanged) =====
    newPage();
    drawText('Full Line Item Breakdown', { size: 14, bold: true, color: brand });
    drawText('All items from both estimates with carrier vs company quantities and pricing.', { size: 8, color: [0.45, 0.45, 0.5] });
    drawDivider(brand);

    const drawFullRow = (l: any) => {
      ensureSpace(56);
      const badgeColor: Record<string, [number, number, number]> =  {
        name_change: [0.85, 0.45, 0.1],
        added: [0.1, 0.4, 0.8], removed: [0.8, 0.2, 0.2],
        qty_change: [0.95, 0.55, 0.1], price_change: [0.6, 0.3, 0.7],
        unchanged: [0.5, 0.5, 0.55],
      };
      const bc = badgeColor[l.change_type] ?? [0.5, 0.5, 0.55];
      page.drawRectangle({ x: MARGIN, y: y - 12, width: 70, height: 12, color: rgb(bc[0], bc[1], bc[2]) });
      page.drawText(safePdfText(l.change_type ?? ''), { x: MARGIN + 4, y: y - 9, size: 7, font: bold, color: rgb(1, 1, 1) });

      const code = l.company_code || l.carrier_code || '—';
      const desc = l.company_description || l.carrier_description || '—';
      page.drawText(safePdfText(code), { x: MARGIN + 78, y: y - 9, size: 9, font: bold, color: rgb(0.1, 0.1, 0.15) });
      const descLines = wrap(desc, 9, PAGE_W - MARGIN - 160);
      page.drawText(safePdfText(descLines[0] ?? ''), { x: MARGIN + 160, y: y - 9, size: 9, font, color: rgb(0.15, 0.15, 0.2) });
      y -= 14;

      const colW = (PAGE_W - MARGIN * 2 - 10) / 2;
      const block = (label: string, qty: any, unit: any, price: any, total: any, x: number) => {
        page.drawText(label, { x, y: y - 8, size: 7, font: bold, color: rgb(0.4, 0.4, 0.45) });
        page.drawText(
          safePdfText(`${fmtQty(qty)} ${unit ?? ''} @ ${fmtMoney(price)} = ${fmtMoney(total)}`),
          { x: x + 50, y: y - 8, size: 8, font, color: rgb(0.1, 0.1, 0.15) }
        );
      };
      block('CARRIER', l.carrier_quantity, l.carrier_unit, l.carrier_unit_price, l.carrier_total_rcv, MARGIN);
      block('COMPANY', l.company_quantity, l.company_unit, l.company_unit_price, l.company_total_rcv, MARGIN + colW + 10);
      y -= 12;

      page.drawText(
        safePdfText(`Delta Qty ${fmtQty(l.delta_quantity)}   Delta Unit ${fmtMoney(l.delta_unit_price)}   Delta RCV ${fmtMoney(l.delta_rcv)}`),
        { x: MARGIN, y: y - 8, size: 8, font: bold, color: rgb(0.55, 0.2, 0.2) }
      );
      y -= 14;

      if (l.justification) {
        for (const w of wrap(`Note: ${l.justification}`, 8, PAGE_W - MARGIN * 2)) {
          ensureSpace(10);
          page.drawText(w, { x: MARGIN, y: y - 8, size: 8, font, color: rgb(0.3, 0.3, 0.35) });
          y -= 10;
        }
      }
      page.drawLine({
        start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
        thickness: 0.3, color: rgb(0.88, 0.88, 0.92),
      });
      y -= 6;
    };

    // Group: changes first, then unchanged
    const order = ['name_change', 'added', 'qty_change', 'price_change', 'removed', 'unchanged'];
    const grouped: Record<string, any[]> = {};
    for (const l of lines ?? []) {
      const k = l.change_type ?? 'unchanged';
      (grouped[k] ||= []).push(l);
    }
    for (const k of order) {
      const arr = grouped[k];
      if (!arr?.length) continue;
      ensureSpace(20);
      drawText(`${CHANGE_LABEL[k]} (${arr.length})`, { size: 11, bold: true, color: brand });
      for (const l of arr) drawFullRow(l);
      y -= 4;
    }

    // ===== Signature =====
    ensureSpace(80);
    drawDivider(brand);
    drawText('Adjuster Acknowledgement', { size: 12, bold: true, color: brand });
    y -= 18;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 240, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    page.drawLine({ start: { x: MARGIN + 280, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    y -= 12;
    drawText('Adjuster Signature', { size: 8, color: [0.4, 0.4, 0.45] });
    page.drawText(safePdfText('Date'), { x: MARGIN + 280, y: y + 4, size: 8, font, color: rgb(0.4, 0.4, 0.45) });

    const pdfBytes = await pdf.save();

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
