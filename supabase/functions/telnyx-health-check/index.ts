// Pre-flight health check used by the Text Blast UI and the SMS Health page.
// POST { target_recipients?, target_window_minutes? } returns a structured report.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');

    const admin = createClient(supabaseUrl, serviceKey);

    // Auth user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ ok: false, error: 'no_tenant' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const targetRecipients = Number(body?.target_recipients ?? 5000);
    const targetWindowMinutes = Number(body?.target_window_minutes ?? 30);

    // Telnyx numbers for tenant
    const { data: locations } = await admin
      .from('locations')
      .select('id, name, telnyx_phone_number, telnyx_messaging_profile_id, messages_per_second, supports_sms, is_active, daily_limit, current_day_sent, tendlc_campaign_status')
      .eq('tenant_id', tenantId);

    const activeSms = (locations || []).filter(
      (l: any) =>
        l.is_active &&
        l.supports_sms &&
        l.telnyx_phone_number &&
        String(l.telnyx_phone_number).trim() !== '',
    );

    const totalMps = activeSms.reduce(
      (s: number, l: any) => s + Number(l.messages_per_second || 1),
      0,
    );
    const requiredMps = targetRecipients / Math.max(targetWindowMinutes * 60, 1);
    const estimatedMinutes =
      totalMps > 0 ? Math.ceil(targetRecipients / (totalMps * 60)) : null;

    // Verify Telnyx messaging profiles
    const profileChecks: any[] = [];
    if (TELNYX_API_KEY) {
      const seen = new Set<string>();
      for (const l of activeSms) {
        if (!l.telnyx_messaging_profile_id || seen.has(l.telnyx_messaging_profile_id)) continue;
        seen.add(l.telnyx_messaging_profile_id);
        try {
          const r = await fetch(
            `https://api.telnyx.com/v2/messaging_profiles/${l.telnyx_messaging_profile_id}`,
            { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } },
          );
          const j = await r.json().catch(() => ({}));
          profileChecks.push({
            messaging_profile_id: l.telnyx_messaging_profile_id,
            ok: r.ok,
            webhook_url: j?.data?.webhook_url || null,
            webhook_failover_url: j?.data?.webhook_failover_url || null,
          });
        } catch (e: any) {
          profileChecks.push({
            messaging_profile_id: l.telnyx_messaging_profile_id,
            ok: false,
            error: String(e?.message || e),
          });
        }
      }
    }

    // Cron schedule check
    let cronScheduled = false;
    try {
      const { data: cronRows } = await admin
        .from('cron.job' as any)
        .select('jobname')
        .eq('jobname', 'sms-blast-processor-every-minute');
      cronScheduled = (cronRows?.length ?? 0) > 0;
    } catch {
      // cron schema not exposed -> ignore
    }

    const checks = {
      telnyx_api_key_present: !!TELNYX_API_KEY,
      tenant_has_sms_numbers: activeSms.length > 0,
      total_messages_per_second: totalMps,
      required_messages_per_second: Number(requiredMps.toFixed(3)),
      estimated_minutes_to_complete: estimatedMinutes,
      capacity_sufficient: totalMps >= requiredMps,
      target_recipients: targetRecipients,
      target_window_minutes: targetWindowMinutes,
      active_numbers: activeSms.map((l: any) => ({
        location_id: l.id,
        name: l.name,
        phone: l.telnyx_phone_number,
        messaging_profile_id: l.telnyx_messaging_profile_id,
        messages_per_second: Number(l.messages_per_second || 1),
        daily_limit: l.daily_limit,
        daily_sent: l.current_day_sent,
        tendlc_status: l.tendlc_campaign_status,
      })),
      profile_checks: profileChecks,
      cron_scheduled: cronScheduled,
    };

    const blockers: string[] = [];
    if (!checks.telnyx_api_key_present) blockers.push('TELNYX_API_KEY missing');
    if (!checks.tenant_has_sms_numbers) blockers.push('No active SMS-capable Telnyx numbers');
    if (!checks.capacity_sufficient)
      blockers.push(
        `Throughput ${totalMps} mps < required ${requiredMps.toFixed(2)} mps for ${targetRecipients} in ${targetWindowMinutes} min`,
      );

    return new Response(
      JSON.stringify({ ok: blockers.length === 0, blockers, checks }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
