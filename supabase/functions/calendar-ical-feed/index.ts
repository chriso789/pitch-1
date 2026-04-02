import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response('Missing token parameter', { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up user by ical_token
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, tenant_id, first_name, last_name')
      .eq('ical_token', token)
      .single();

    if (profileError || !profile) {
      return new Response('Invalid token', { status: 401, headers: corsHeaders });
    }

    // Fetch appointments for next 90 days and past 30 days
    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const { data: appointments, error: aptError } = await supabase
      .from('appointments')
      .select(`
        id, title, appointment_type, scheduled_start, scheduled_end,
        status, address, notes,
        contact:contacts(first_name, last_name)
      `)
      .eq('tenant_id', profile.tenant_id)
      .or(`assigned_to.eq.${profile.id},created_by.eq.${profile.id}`)
      .gte('scheduled_start', past.toISOString())
      .lte('scheduled_start', future.toISOString())
      .order('scheduled_start');

    if (aptError) {
      console.error('Error fetching appointments:', aptError);
      return new Response('Error fetching calendar data', { status: 500, headers: corsHeaders });
    }

    // Build iCal output
    const calName = `PITCH CRM - ${profile.first_name || ''} ${profile.last_name || ''}`.trim();
    const events = (appointments || []).map(apt => {
      const contact = apt.contact as any;
      const contactName = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
      const description = [
        apt.appointment_type ? `Type: ${apt.appointment_type}` : '',
        contactName ? `Contact: ${contactName}` : '',
        apt.notes || '',
      ].filter(Boolean).join('\\n');

      const dtStart = formatICalDate(apt.scheduled_start);
      const dtEnd = formatICalDate(apt.scheduled_end);

      return [
        'BEGIN:VEVENT',
        `UID:${apt.id}@pitch-crm`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${escapeIcal(apt.title)}`,
        apt.address ? `LOCATION:${escapeIcal(apt.address)}` : '',
        description ? `DESCRIPTION:${escapeIcal(description)}` : '',
        `STATUS:${apt.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
        'END:VEVENT',
      ].filter(Boolean).join('\r\n');
    });

    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PITCH CRM//Calendar//EN',
      `X-WR-CALNAME:${calName}`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');

    return new Response(ical, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pitch-calendar.ics"',
      },
    });
  } catch (error) {
    console.error('iCal feed error:', error);
    return new Response('Internal server error', { status: 500, headers: corsHeaders });
  }
});

function formatICalDate(isoString: string): string {
  return isoString.replace(/[-:]/g, '').replace(/\.\d+/, '').replace('+00:00', 'Z');
}

function escapeIcal(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
