// Public booking service for demo invitations (public signed-token route).
// The booking token is the only credential; tenant/host come from the stored invitation.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { z } from 'npm:zod@3.25.76';
import { notifySenderEngagement } from '../_shared/engagement-notify.ts';
import { DEMO_ALERT_EMAIL } from '../_shared/demo-booking/alerts.ts';
import { createDemoEvent, fetchBusy, overlapsBusy, type DemoRow } from '../_shared/demo-booking/calendar.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pitch-tenant', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), token: z.string().min(20).max(200) }),
  z.object({ action: z.literal('confirm'), token: z.string().min(20).max(200), slot: z.string().datetime() }),
]);
const ADMIN_URL = 'https://pitch-crm.ai/admin/companies';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtEastern = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

async function hostTenant(db: any, hostId: string | null): Promise<string | null> {
  if (!hostId) return null;
  const { data } = await db.from('profiles').select('tenant_id').eq('id', hostId).maybeSingle();
  return data?.tenant_id ?? null;
}

async function notifyHost(db: any, demo: any, title: string, message: string, detailLines: string[], type: string) {
  try {
    const tenantId = await hostTenant(db, demo.assigned_to);
    if (!tenantId) { console.log('[demo-booking] no host tenant, notification skipped', demo.id); return; }
    await notifySenderEngagement({
      supabase: db, tenantId, userId: demo.assigned_to, title, message,
      detailLines, actionUrl: ADMIN_URL, type, metadata: { demo_request_id: demo.id }, emailTo: DEMO_ALERT_EMAIL,
    });
  } catch (e) { console.error('[demo-booking] host notification failed', e); }
}

Deno.serve(async req => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return reply(null);
  try {
    const input = schema.safeParse(await req.json());
    if (!input.success) return reply({ error: 'Invalid booking request' }, 400);
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Booking service unavailable');
    const db = createClient(url, key);
    const token = input.data.token;

    const loadDemo = async () => {
      const { data, error } = await db.from('demo_requests')
        .select('id, first_name, last_name, email, phone, company_name, confirmed_slot, google_event_id, meeting_link, assigned_to')
        .eq('booking_token', token).maybeSingle();
      if (error) throw error;
      return data;
    };

    if (input.data.action === 'confirm') {
      const slot = new Date(input.data.slot).toISOString();
      const before = await loadDemo();
      if (!before) return reply({ error: 'This booking link is unavailable.' }, 404);
      const newlyBooked = !before.confirmed_slot;

      // Respect anything already on the support calendar (other meetings, manual blocks).
      if (newlyBooked) {
        const busy = await fetchBusy(slot, new Date(Date.parse(slot) + 30 * 60_000).toISOString());
        if (busy && overlapsBusy(slot, busy)) return reply({ error: 'This time is no longer available. Please choose another time.' }, 409);
      }

      const { error } = await db.rpc('confirm_demo_slot_by_token', { _token: token, _slot: slot });
      if (error) return reply({ error: error.message }, 409);

      const demo = await loadDemo();
      let meetingLink: string | null = demo?.meeting_link ?? null;
      let calendarError: string | null = null;
      if (demo && !demo.google_event_id) {
        const cal = await createDemoEvent(demo as DemoRow);
        if (cal.ok) {
          meetingLink = cal.meetLink ?? meetingLink;
          await db.from('demo_requests').update({
            google_event_id: cal.eventId, google_event_link: cal.htmlLink, meeting_link: meetingLink,
            calendar_synced_at: new Date().toISOString(), calendar_sync_error: null,
          }).eq('id', demo.id);
        } else {
          calendarError = cal.error;
          await db.from('demo_requests').update({ calendar_sync_error: cal.error }).eq('id', demo.id);
        }
      }

      if (demo && newlyBooked) {
        const who = [demo.first_name, demo.last_name].filter(Boolean).join(' ') || demo.email;
        await notifyHost(db, demo,
          'Demo booked',
          `${esc(who)}${demo.company_name ? ` (${esc(demo.company_name)})` : ''} booked a demo for ${fmtEastern(slot)}.`,
          [
            calendarError
              ? `Not added to the support@pitch-crm.ai calendar: ${esc(calendarError)}`
              : 'Added to the support@pitch-crm.ai Google Calendar and invite emailed to the guest.',
            meetingLink ? `Google Meet: ${esc(meetingLink)}` : 'No Google Meet link was created.',
          ],
          'appointment_scheduled');
      }
      return reply({ success: true, id: demo?.id, meeting_link: meetingLink, calendar_added: !calendarError });
    }

    const [info, slots] = await Promise.all([
      db.rpc('get_demo_request_by_token', { _token: token }),
      db.rpc('get_demo_available_slots', { _token: token }),
    ]);
    if (info.error || slots.error) throw info.error || slots.error;
    if (!info.data?.length) return reply({ error: 'This booking link is unavailable.' }, 404);
    const row = info.data[0];

    // Record the visit; tell the host the first time the link is opened.
    const { data: opened } = await db.rpc('record_demo_booking_open', { _token: token });
    if (opened?.[0]?.first_open) {
      const demo = await loadDemo();
      if (demo) {
        const who = [demo.first_name, demo.last_name].filter(Boolean).join(' ') || demo.email;
        await notifyHost(db, demo, 'Booking link opened',
          `${esc(who)}${demo.company_name ? ` (${esc(demo.company_name)})` : ''} opened their demo booking link.`,
          ['They have not picked a time yet. You will get another alert when they book.'],
          'lead_hot');
      }
    }

    let available: string[] = (slots.data ?? []).map((s: { slot: string }) => new Date(s.slot).toISOString());
    if (available.length) {
      const busy = await fetchBusy(available[0], new Date(Date.parse(available[available.length - 1]) + 30 * 60_000).toISOString());
      if (busy) available = available.filter(s => !overlapsBusy(s, busy));
    }
    const { data: meet } = row.confirmed_slot
      ? await db.from('demo_requests').select('meeting_link').eq('booking_token', token).maybeSingle()
      : { data: null };
    return reply({ info: { ...row, meeting_link: meet?.meeting_link ?? null }, slots: available });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : 'Booking service unavailable' }, 400); }
});
