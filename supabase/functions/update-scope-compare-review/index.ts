// ============================================================
// update-scope-compare-review
// Reviewer actions on a single scope_compare_results row:
// include/exclude, mark reviewed/unreviewed, add note,
// override match (creates scope_compare_overrides row),
// clear override.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

type Action =
  | 'include'
  | 'exclude'
  | 'mark_reviewed'
  | 'mark_unreviewed'
  | 'add_note'
  | 'override_match'
  | 'clear_override';

interface Body {
  compare_result_id: string;
  action: Action;
  reviewer_note?: string;
  carrier_line_item_id?: string;
  contractor_line_item_id?: string;
}

const ALLOWED: Action[] = [
  'include',
  'exclude',
  'mark_reviewed',
  'mark_unreviewed',
  'add_note',
  'override_match',
  'clear_override',
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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
    if (!body?.compare_result_id || !body?.action) {
      return json(400, { error: 'compare_result_id and action required' });
    }
    if (!ALLOWED.includes(body.action)) return json(400, { error: 'invalid_action' });

    const { data: row, error: rowErr } = await admin
      .from('scope_compare_results')
      .select('*')
      .eq('id', body.compare_result_id)
      .maybeSingle();
    if (rowErr) return json(500, { error: rowErr.message });
    if (!row) return json(404, { error: 'compare_result_not_found' });

    const { data: profile } = await admin
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', userId)
      .maybeSingle();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId || tenantId !== row.tenant_id) {
      return json(403, { error: 'forbidden_tenant_mismatch' });
    }

    const patch: Record<string, unknown> = {};
    switch (body.action) {
      case 'include':
        patch.included_in_supplement = true;
        break;
      case 'exclude':
        patch.included_in_supplement = false;
        break;
      case 'mark_reviewed':
        patch.reviewer_status = 'reviewed';
        break;
      case 'mark_unreviewed':
        patch.reviewer_status = 'unreviewed';
        break;
      case 'add_note':
        patch.reviewer_note = body.reviewer_note ?? null;
        break;
      case 'override_match': {
        if (body.carrier_line_item_id) patch.carrier_line_item_id = body.carrier_line_item_id;
        if (body.contractor_line_item_id) patch.contractor_line_item_id = body.contractor_line_item_id;
        patch.reviewer_status = 'reviewed';
        await admin.from('scope_compare_overrides').insert({
          tenant_id: tenantId,
          compare_run_id: row.compare_run_id,
          result_id: row.id,
          override_type: 'match_override',
          carrier_line_item_id: body.carrier_line_item_id ?? null,
          contractor_line_item_id: body.contractor_line_item_id ?? null,
          reviewer_note: body.reviewer_note ?? null,
          payload: {
            previous_carrier_line_item_id: row.carrier_line_item_id ?? null,
            previous_contractor_line_item_id: row.contractor_line_item_id ?? null,
          },
          created_by: userId,
        });
        break;
      }
      case 'clear_override': {
        await admin
          .from('scope_compare_overrides')
          .delete()
          .eq('result_id', row.id)
          .eq('tenant_id', tenantId);
        break;
      }
    }

    let updated = row;
    if (Object.keys(patch).length > 0) {
      const { data: u, error: uErr } = await admin
        .from('scope_compare_results')
        .update(patch)
        .eq('id', row.id)
        .select()
        .single();
      if (uErr) return json(500, { error: uErr.message });
      updated = u;
    }

    return json(200, { success: true, result: updated });
  } catch (e) {
    return json(500, { error: 'unexpected', message: (e as Error).message });
  }
});
