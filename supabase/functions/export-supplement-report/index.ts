// ============================================================
// export-supplement-report
// Generates JSON / CSV / Markdown / HTML exports from a
// previously generated supplement_reports row, uploads to
// the 'documents' storage bucket, returns signed URL.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Body {
  supplement_report_id: string;
  export_type: 'json' | 'csv' | 'markdown' | 'html';
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const CSV_COLS = [
  'issue_type',
  'severity',
  'section',
  'included',
  'carrier_description',
  'contractor_description',
  'quantity',
  'unit',
  'carrier_quantity',
  'contractor_quantity',
  'quantity_delta',
  'carrier_unit_price',
  'contractor_unit_price',
  'unit_price_delta',
  'carrier_total_rcv',
  'contractor_total_rcv',
  'total_rcv_delta',
  'tax_delta',
  'confidence',
  'justification',
  'evidence_page',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: 'Unauthorized' });
    const userId = userData.user.id;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.supplement_report_id || !body?.export_type) {
      return json(400, { error: 'supplement_report_id and export_type required' });
    }
    if (!['json', 'csv', 'markdown', 'html'].includes(body.export_type)) {
      return json(400, { error: 'invalid export_type' });
    }

    const { data: report, error: rErr } = await admin
      .from('supplement_reports')
      .select('*')
      .eq('id', body.supplement_report_id)
      .maybeSingle();
    if (rErr) return json(500, { error: rErr.message });
    if (!report) return json(404, { error: 'report_not_found' });

    const { data: profile } = await admin
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', userId)
      .maybeSingle();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId || tenantId !== report.tenant_id) {
      return json(403, { error: 'forbidden_tenant_mismatch' });
    }

    const { data: items } = await admin
      .from('supplement_report_items')
      .select('*')
      .eq('supplement_report_id', report.id)
      .order('item_order', { ascending: true });

    let content: string;
    let contentType: string;
    let ext: string;

    if (body.export_type === 'json') {
      content = JSON.stringify(
        {
          report: {
            id: report.id,
            report_status: report.report_status,
            summary: report.report_json?.summary ?? null,
            ...report.report_json,
          },
          items: items ?? [],
        },
        null,
        2,
      );
      contentType = 'application/json';
      ext = 'json';
    } else if (body.export_type === 'markdown') {
      content = report.report_markdown ?? '';
      contentType = 'text/markdown';
      ext = 'md';
    } else if (body.export_type === 'html') {
      content = report.report_html ?? '';
      contentType = 'text/html';
      ext = 'html';
    } else {
      // csv
      const rows: string[] = [CSV_COLS.join(',')];
      for (const it of items ?? []) {
        const ev = (it.evidence ?? {}) as Record<string, unknown>;
        const just =
          it.justification_adjuster || it.justification_plain || it.justification_contractor || '';
        const confidence = (ev as any)?.match_confidence ?? null;
        const page = (ev as any)?.page_number ?? (ev as any)?.evidence_page ?? null;
        const row = [
          it.issue_type,
          it.severity,
          it.section,
          it.included,
          it.carrier_description,
          it.contractor_description,
          it.quantity,
          it.unit,
          it.carrier_quantity,
          it.contractor_quantity,
          it.quantity_delta,
          it.carrier_unit_price,
          it.contractor_unit_price,
          it.unit_price_delta,
          it.carrier_total_rcv,
          it.contractor_total_rcv,
          it.total_rcv_delta,
          it.tax_delta,
          confidence,
          just,
          page,
        ].map(csvEscape).join(',');
        rows.push(row);
      }
      content = rows.join('\n');
      contentType = 'text/csv';
      ext = 'csv';
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${tenantId}/supplement-reports/${report.id}/${body.export_type}-${ts}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('documents')
      .upload(path, new Blob([content], { type: contentType }), {
        contentType,
        upsert: true,
      });
    if (upErr) return json(500, { error: `upload_failed: ${upErr.message}` });

    const { data: signed } = await admin.storage
      .from('documents')
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    await admin.from('supplement_report_exports').insert({
      tenant_id: tenantId,
      supplement_report_id: report.id,
      export_type: body.export_type,
      storage_path: path,
      export_json: { content_type: contentType, bytes: content.length },
      created_by: userId,
    });

    return json(200, {
      success: true,
      export_type: body.export_type,
      storage_path: path,
      download_url: signed?.signedUrl ?? null,
    });
  } catch (e) {
    return json(500, { error: 'unexpected', message: (e as Error).message });
  }
});
