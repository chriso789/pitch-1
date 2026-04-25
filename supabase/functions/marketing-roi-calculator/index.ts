import { handleOptions, json, badRequest, serverError } from '../_shared/http.ts';
import { verifyAuthAndTenant } from '../_shared/auth-tenant.ts';

Deno.serve(async (req) => {
  const optRes = handleOptions(req);
  if (optRes) return optRes;

  if (req.method !== 'POST') return badRequest('Method not allowed');

  try {
    const { tenant_id: requested, days, group_by } = await req.json();

    const auth = await verifyAuthAndTenant(req, requested);
    if (auth.error) return auth.error;
    const { tenantId: tenant_id, supabase } = auth;

    const since = new Date();
    since.setDate(since.getDate() - (days || 30));

    // 1. Get attribution events with revenue
    const { data: events, error: eventsErr } = await supabase
      .from('lead_attribution_events')
      .select('source, medium, campaign, cost, revenue_attributed, event_type, pipeline_entry_id')
      .eq('tenant_id', tenant_id)
      .gte('event_at', since.toISOString())
      .limit(2000);

    if (eventsErr) return serverError(eventsErr);

    // 2. Get pipeline entries that converted to projects for revenue
    const entryIds = [...new Set((events || []).map((e: any) => e.pipeline_entry_id).filter(Boolean))];
    let entryRevenue: Record<string, number> = {};

    if (entryIds.length > 0) {
      // Batch in groups of 50
      for (let i = 0; i < entryIds.length; i += 50) {
        const batch = entryIds.slice(i, i + 50);
        const { data: entries } = await supabase
          .from('pipeline_entries')
          .select('id, estimated_value, status')
          .in('id', batch);

        for (const e of entries || []) {
          if (e.estimated_value) {
            entryRevenue[e.id] = e.estimated_value;
          }
        }
      }
    }

    // 3. Aggregate by group
    const groupKey = group_by || 'source';
    const buckets: Record<string, {
      leads: number;
      cost: number;
      revenue: number;
      conversions: number;
    }> = {};

    for (const ev of events || []) {
      let key = ev.source || 'unknown';
      if (groupKey === 'campaign') key = ev.campaign || '(none)';
      if (groupKey === 'medium') key = ev.medium || '(none)';
      if (groupKey === 'source_campaign') key = `${ev.source}/${ev.campaign || '(none)'}`;

      if (!buckets[key]) buckets[key] = { leads: 0, cost: 0, revenue: 0, conversions: 0 };
      buckets[key].leads++;
      buckets[key].cost += ev.cost || 0;

      const rev = ev.revenue_attributed || (ev.pipeline_entry_id ? entryRevenue[ev.pipeline_entry_id] || 0 : 0);
      buckets[key].revenue += rev;
      if (rev > 0) buckets[key].conversions++;
    }

    const results = Object.entries(buckets)
      .map(([name, b]) => ({
        name,
        leads: b.leads,
        conversions: b.conversions,
        conversion_rate: b.leads > 0 ? +(b.conversions / b.leads * 100).toFixed(1) : 0,
        total_cost: +b.cost.toFixed(2),
        total_revenue: +b.revenue.toFixed(2),
        roi_pct: b.cost > 0 ? +((b.revenue - b.cost) / b.cost * 100).toFixed(1) : null,
        cost_per_lead: b.leads > 0 ? +(b.cost / b.leads).toFixed(2) : 0,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue);

    // 4. Totals
    const totals = results.reduce((acc, r) => ({
      leads: acc.leads + r.leads,
      conversions: acc.conversions + r.conversions,
      cost: acc.cost + r.total_cost,
      revenue: acc.revenue + r.total_revenue,
    }), { leads: 0, conversions: 0, cost: 0, revenue: 0 });

    return json({
      ok: true,
      period_days: days || 30,
      group_by: groupKey,
      results,
      totals: {
        ...totals,
        roi_pct: totals.cost > 0 ? +((totals.revenue - totals.cost) / totals.cost * 100).toFixed(1) : null,
        conversion_rate: totals.leads > 0 ? +(totals.conversions / totals.leads * 100).toFixed(1) : 0,
      },
    });
  } catch (err) {
    console.error('[marketing-roi-calculator] Error:', err);
    return serverError(err);
  }
});
