// Retry hook for putting a booked demo on the support@pitch-crm.ai calendar.
// The booking service already does this on confirmation; this is idempotent
// (deterministic event id), so older pages that still call it cannot duplicate events.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createDemoEvent, type DemoRow } from '../_shared/demo-booking/calendar.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage, x-pitch-tenant, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token } = await req.json().catch(() => ({ token: null }));
    if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return json({ error: 'token is required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: demo, error } = await admin.from('demo_requests')
      .select('id, first_name, last_name, email, phone, company_name, confirmed_slot, google_event_id, google_event_link, meeting_link, status')
      .eq('booking_token', token).maybeSingle();
    if (error) throw error;
    if (!demo?.confirmed_slot) return json({ error: 'No confirmed slot for this request' }, 404);
    if (['declined', 'spam', 'rejected'].includes((demo.status ?? '').toLowerCase())) return json({ error: 'Demo request is declined — not syncing to calendar' }, 409);
    if (demo.google_event_id) return json({ ok: true, event_id: demo.google_event_id, html_link: demo.google_event_link, meeting_link: demo.meeting_link });

    const cal = await createDemoEvent(demo as DemoRow);
    if (!cal.ok) {
      await admin.from('demo_requests').update({ calendar_sync_error: cal.error }).eq('id', demo.id);
      return json({ error: 'Google Calendar request failed', details: cal.error }, 502);
    }
    await admin.from('demo_requests').update({
      google_event_id: cal.eventId, google_event_link: cal.htmlLink, meeting_link: cal.meetLink ?? demo.meeting_link,
      calendar_synced_at: new Date().toISOString(), calendar_sync_error: null, interview_status: 'scheduled',
    }).eq('id', demo.id);
    return json({ ok: true, event_id: cal.eventId, html_link: cal.htmlLink, meeting_link: cal.meetLink });
  } catch (e) {
    console.error('google-calendar-demo-sync error', e);
    return json({ error: 'Calendar sync failed' }, 500);
  }
});
