// Google Calendar helpers for PITCH demo bookings (support@pitch-crm.ai).
// Events use a deterministic id so a retry can never create a second event.

export const DEMO_CALENDAR_ID = 'support@pitch-crm.ai';
export const DEMO_MINUTES = 30;
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_calendar/calendar/v3';

export interface DemoRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  confirmed_slot: string | null;
  google_event_id: string | null;
}

export interface BusyRange { start: number; end: number }

function gatewayHeaders(): Record<string, string> | null {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const connKey = Deno.env.get('GOOGLE_CALENDAR_API_KEY');
  if (!lovableKey || !connKey) return null;
  return { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': connKey, 'Content-Type': 'application/json' };
}

/** Google event ids allow a-v and 0-9; a uuid's hex digits fit. */
export function demoEventId(demoId: string): string {
  return `pitchdemo${demoId.replace(/-/g, '').toLowerCase()}`;
}

/** True when [slot, slot+30m) overlaps any busy range. */
export function overlapsBusy(slotIso: string, busy: BusyRange[]): boolean {
  const start = Date.parse(slotIso);
  const end = start + DEMO_MINUTES * 60_000;
  return busy.some(b => b.start < end && b.end > start);
}

/** Busy times on the support calendar, or null when Google can't be reached. */
export async function fetchBusy(fromIso: string, toIso: string): Promise<BusyRange[] | null> {
  const headers = gatewayHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/freeBusy`, {
      method: 'POST', headers,
      body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, items: [{ id: DEMO_CALENDAR_ID }] }),
    });
    const text = await res.text();
    if (!res.ok) { console.error(`[demo-calendar] freeBusy failed [${res.status}]: ${text}`); return null; }
    const busy = JSON.parse(text)?.calendars?.[DEMO_CALENDAR_ID]?.busy ?? [];
    return busy.map((b: { start: string; end: string }) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  } catch (e) {
    console.error('[demo-calendar] freeBusy error', e);
    return null;
  }
}

export type CalendarResult =
  | { ok: true; eventId: string; htmlLink: string | null; meetLink: string | null }
  | { ok: false; error: string };

function readMeet(event: any): string | null {
  if (event?.hangoutLink) return event.hangoutLink;
  const entry = (event?.conferenceData?.entryPoints ?? []).find((e: any) => e.entryPointType === 'video');
  return entry?.uri ?? null;
}

/** Create (or fetch the existing) calendar event with a Google Meet link and the guest invited. */
export async function createDemoEvent(demo: DemoRow): Promise<CalendarResult> {
  const headers = gatewayHeaders();
  if (!headers) return { ok: false, error: 'Google Calendar is not connected' };
  if (!demo.confirmed_slot) return { ok: false, error: 'No confirmed time' };

  const eventId = demoEventId(demo.id);
  const base = `${GATEWAY_URL}/calendars/${encodeURIComponent(DEMO_CALENDAR_ID)}/events`;
  const start = new Date(demo.confirmed_slot);
  const end = new Date(start.getTime() + DEMO_MINUTES * 60_000);
  const who = [demo.first_name, demo.last_name].filter(Boolean).join(' ') || demo.email || 'Guest';

  const body = {
    id: eventId,
    summary: `PITCH CRM Demo: ${demo.company_name || who}`,
    description: [
      'PITCH CRM 30-minute video demo',
      `Contact: ${who}`,
      demo.company_name ? `Company: ${demo.company_name}` : null,
      demo.email ? `Email: ${demo.email}` : null,
      demo.phone ? `Phone: ${demo.phone}` : null,
    ].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: demo.email ? [{ email: demo.email, displayName: who }] : [],
    conferenceData: { createRequest: { requestId: eventId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
  };

  const res = await fetch(`${base}?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  let text = await res.text();
  let event: any;
  if (res.status === 409) {
    // Already created by an earlier attempt — read it back instead of duplicating.
    const existing = await fetch(`${base}/${eventId}`, { headers });
    text = await existing.text();
    if (!existing.ok) return { ok: false, error: `Google Calendar [${existing.status}]: ${text.slice(0, 300)}` };
    event = JSON.parse(text);
  } else if (!res.ok) {
    console.error(`[demo-calendar] insert failed [${res.status}]: ${text}`);
    return { ok: false, error: `Google Calendar [${res.status}]: ${text.slice(0, 300)}` };
  } else {
    event = JSON.parse(text);
  }

  let meet = readMeet(event);
  if (!meet) {
    // Meet links are occasionally provisioned a moment after the event is created.
    await new Promise(r => setTimeout(r, 1500));
    const again = await fetch(`${base}/${eventId}`, { headers });
    if (again.ok) { event = await again.json(); meet = readMeet(event); }
  }
  return { ok: true, eventId: event.id ?? eventId, htmlLink: event.htmlLink ?? null, meetLink: meet };
}
