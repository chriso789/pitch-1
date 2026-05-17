// ============================================================
// xact-recompute-comparisons
// Re-runs xact-compare-documents over every existing comparison
// row so persisted carrier/company unit prices reflect the new
// aggregation + unit-equality pairing logic.
//
// Scope:
//   - default: only comparisons owned by the caller's tenant
//   - master role: all tenants when body.all_tenants === true
//
// Idempotent: deletes the old scope_comparison_lines for each
// run before re-inserting, then patches scope_comparisons totals.
// ============================================================
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService, supabaseAuth } from '../_shared/supabase.ts';

interface RecomputeBody {
  comparison_ids?: string[];        // recompute only these
  project_id?: string;              // recompute every comparison on a project
  all_tenants?: boolean;            // master-only
  dry_run?: boolean;
}

async function callXactCompare(authHeader: string, body: Record<string, unknown>) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/xact-compare-documents`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, status: resp.status, body: JSON.parse(text) };
  } catch {
    return { ok: resp.ok, status: resp.status, body: text };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const auth = supabaseAuth(req);
    const { data: userData } = await auth.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const svc = supabaseService();
    const { data: profile } = await svc
      .from('profiles')
      .select('tenant_id, active_tenant_id, role')
      .eq('id', user.id)
      .single();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    const isMaster = profile?.role === 'master' || profile?.role === 'COB';

    const body = (await req.json().catch(() => ({}))) as RecomputeBody;

    // Build the target list
    let q = svc
      .from('scope_comparisons')
      .select('id, tenant_id, project_id, job_id, carrier_document_id, company_document_id');
    if (body.comparison_ids?.length) {
      q = q.in('id', body.comparison_ids);
    } else if (body.project_id) {
      q = q.eq('project_id', body.project_id);
    }
    if (!isMaster || !body.all_tenants) {
      if (!tenantId) {
        return new Response(JSON.stringify({ error: 'No tenant' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      q = q.eq('tenant_id', tenantId);
    }
    let { data: targets, error } = await q;
    if (error) throw error;

    if (body.comparison_ids?.length && targets?.length) {
      const docIds = Array.from(new Set(targets.flatMap((t: any) => [t.carrier_document_id, t.company_document_id]).filter(Boolean)));
      const { data: seedDocs } = await svc
        .from('insurance_scope_documents')
        .select('id, tenant_id, document_type, file_hash')
        .in('id', docIds);
      const hashes = Array.from(new Set((seedDocs || []).map((d: any) => d.file_hash).filter(Boolean)));
      if (hashes.length) {
        const { data: hashDocs } = await svc
          .from('insurance_scope_documents')
          .select('id, document_type, file_hash')
          .in('file_hash', hashes);
        const carrierIds = (hashDocs || []).filter((d: any) => d.document_type !== 'company_scope').map((d: any) => d.id);
        const companyIds = (hashDocs || []).filter((d: any) => d.document_type === 'company_scope').map((d: any) => d.id);
        if (carrierIds.length && companyIds.length) {
          const projectIds = Array.from(new Set(targets.map((t: any) => t.project_id).filter(Boolean)));
          let siblingQ = svc
            .from('scope_comparisons')
            .select('id, tenant_id, project_id, job_id, carrier_document_id, company_document_id')
            .in('carrier_document_id', carrierIds)
            .in('company_document_id', companyIds);
          if (projectIds.length) siblingQ = siblingQ.in('project_id', projectIds);
          if (!isMaster || !body.all_tenants) siblingQ = siblingQ.eq('tenant_id', tenantId);
          const { data: siblings } = await siblingQ;
          const byId = new Map((targets || []).map((t: any) => [t.id, t]));
          for (const s of siblings || []) byId.set(s.id, s);
          targets = Array.from(byId.values());
        }
      }
    }

    if (body.dry_run) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        would_recompute: targets?.length ?? 0,
        sample: (targets ?? []).slice(0, 10).map(t => t.id),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
    for (const t of targets || []) {
      try {
        // Wipe old lines for this comparison so the re-run is clean
        await svc.from('scope_comparison_lines').delete().eq('comparison_id', t.id);
        // Re-run the comparison via the canonical edge function
        const r = await callXactCompare(authHeader, {
          carrier_document_id: t.carrier_document_id,
          company_document_id: t.company_document_id,
          project_id: t.project_id,
          job_id: t.job_id,
        });
        if (!r.ok) {
          results.push({ id: t.id, ok: false, reason: `compare failed: ${r.status} ${JSON.stringify(r.body)}` });
          continue;
        }
        // The compare function creates a NEW scope_comparisons row.
        // Copy its totals back onto the original row so existing UI links keep working,
        // then delete the duplicate.
        const newId = (r.body as any)?.comparison_id;
        if (newId && newId !== t.id) {
          const { data: dup } = await svc
            .from('scope_comparisons')
            .select('carrier_total_rcv, company_total_rcv, net_supplement_amount, added_count, removed_count, qty_change_count, price_change_count, totals_json')
            .eq('id', newId)
            .single();
          if (dup) {
            await svc.from('scope_comparisons').update({
              ...dup,
              updated_at: new Date().toISOString(),
            }).eq('id', t.id);
            // Move the freshly inserted lines from newId → t.id
            await svc.from('scope_comparison_lines').update({ comparison_id: t.id }).eq('comparison_id', newId);
            await svc.from('scope_comparisons').delete().eq('id', newId);
          }
        }
        results.push({ id: t.id, ok: true });
      } catch (e: any) {
        results.push({ id: t.id, ok: false, reason: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: targets?.length ?? 0,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('xact-recompute-comparisons error', e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
