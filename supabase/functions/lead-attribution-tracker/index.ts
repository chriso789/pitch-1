import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { corsHeaders, handleOptions, json, badRequest, serverError } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const optRes = handleOptions(req);
  if (optRes) return optRes;

  if (req.method !== 'POST') return badRequest('Method not allowed');

  try {
    const body = await req.json();
    const { action } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ──────────────────────────────────────────────
    // ACTION: track – record a lead attribution event
    // ──────────────────────────────────────────────
    if (action === 'track') {
      const {
        tenant_id, contact_id, pipeline_entry_id,
        source, medium, campaign, term, content,
        landing_page, referrer_url, event_type,
        attribution_model, cost, utm_params, metadata,
      } = body;

      if (!tenant_id || !source || !event_type) {
        return badRequest('tenant_id, source, and event_type are required');
      }

      const { data, error } = await supabase
        .from('lead_attribution_events')
        .insert({
          tenant_id,
          contact_id: contact_id || null,
          pipeline_entry_id: pipeline_entry_id || null,
          source,
          medium: medium || null,
          campaign: campaign || null,
          term: term || null,
          content: content || null,
          landing_page: landing_page || null,
          referrer_url: referrer_url || null,
          event_type,
          event_at: new Date().toISOString(),
          attribution_model: attribution_model || 'last_touch',
          attribution_weight: 1.0,
          cost: cost || null,
          utm_params: utm_params || null,
          metadata: metadata || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[lead-attribution-tracker] Insert error:', error);
        return serverError(error);
      }

      console.log('[lead-attribution-tracker] Tracked event:', data.id);
      return json({ ok: true, event_id: data.id });
    }

    // ──────────────────────────────────────────────
    // ACTION: convert – mark a marketing session as converted
    // ──────────────────────────────────────────────
    if (action === 'convert') {
      const { tenant_id, contact_id, pipeline_entry_id, session_id } = body;

      if (!tenant_id) return badRequest('tenant_id is required');

      // Update marketing session if provided
      if (session_id) {
        await supabase
          .from('marketing_sessions')
          .update({
            converted: true,
            converted_at: new Date().toISOString(),
            contact_id: contact_id || undefined,
          })
          .eq('id', session_id)
          .eq('tenant_id', tenant_id);
      }

      // Also attribute revenue on lead_attribution_events if pipeline_entry_id given
      if (pipeline_entry_id) {
        const { data: entry } = await supabase
          .from('pipeline_entries')
          .select('estimated_value')
          .eq('id', pipeline_entry_id)
          .single();

        if (entry?.estimated_value) {
          await supabase
            .from('lead_attribution_events')
            .update({ revenue_attributed: entry.estimated_value })
            .eq('pipeline_entry_id', pipeline_entry_id)
            .eq('tenant_id', tenant_id);
        }
      }

      return json({ ok: true });
    }

    // ──────────────────────────────────────────────
    // ACTION: summary – first/last touch attribution summary
    // ──────────────────────────────────────────────
    if (action === 'summary') {
      const { tenant_id, days } = body;
      if (!tenant_id) return badRequest('tenant_id is required');

      const since = new Date();
      since.setDate(since.getDate() - (days || 30));

      const { data, error } = await supabase
        .from('lead_attribution_events')
        .select('source, medium, campaign, event_type, cost, revenue_attributed')
        .eq('tenant_id', tenant_id)
        .gte('event_at', since.toISOString())
        .order('event_at', { ascending: false })
        .limit(1000);

      if (error) return serverError(error);

      // Aggregate by source
      const bySource: Record<string, { leads: number; cost: number; revenue: number }> = {};
      for (const row of data || []) {
        const key = `${row.source}|${row.medium || ''}|${row.campaign || ''}`;
        if (!bySource[key]) bySource[key] = { leads: 0, cost: 0, revenue: 0 };
        bySource[key].leads++;
        bySource[key].cost += row.cost || 0;
        bySource[key].revenue += row.revenue_attributed || 0;
      }

      const summary = Object.entries(bySource).map(([key, v]) => {
        const [source, medium, campaign] = key.split('|');
        return {
          source, medium, campaign,
          leads: v.leads,
          cost: v.cost,
          revenue: v.revenue,
          roi: v.cost > 0 ? ((v.revenue - v.cost) / v.cost * 100).toFixed(1) : null,
        };
      });

      return json({ ok: true, summary });
    }

    return badRequest(`Unknown action: ${action}`);
  } catch (err) {
    console.error('[lead-attribution-tracker] Error:', err);
    return serverError(err);
  }
});
