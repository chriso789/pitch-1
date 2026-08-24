import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_calendar/calendar/v3';
const CALENDAR_ID = 'support@pitch-crm.ai';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { token } = await req.json().catch(() => ({ token: null }));
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'token is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const connKey = Deno.env.get('GOOGLE_CALENDAR_API_KEY');
    if (!lovableKey || !connKey) {
      return new Response(JSON.stringify({ error: 'Google Calendar is not connected' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: demo, error } = await admin
      .from('demo_requests')
      .select('*')
      .eq('scheduling_token', token)
      .maybeSingle();

    if (error) throw error;
    if (!demo?.scheduled_at) {
      return new Response(JSON.stringify({ error: 'No confirmed slot for this request' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const start = new Date(demo.scheduled_at);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const who = [demo.first_name, demo.last_name].filter(Boolean).join(' ') || demo.email;

    const res = await fetch(`${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': connKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: `Demo: ${demo.company_name || who}`,
        description: [
          'PITCH CRM video demo',
          `Contact: ${who}`,
          demo.email ? `Email: ${demo.email}` : null,
          demo.phone ? `Phone: ${demo.phone}` : null,
          demo.meeting_link ? `Meeting: ${demo.meeting_link}` : null,
        ].filter(Boolean).join('\n'),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      console.error(`Google Calendar insert failed [${res.status}]: ${bodyText}`);
      return new Response(
        JSON.stringify({ error: 'Google Calendar request failed', status: res.status, details: bodyText }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const event = JSON.parse(bodyText);
    return new Response(JSON.stringify({ ok: true, event_id: event.id, html_link: event.htmlLink }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('google-calendar-demo-sync error', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
