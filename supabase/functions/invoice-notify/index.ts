// invoice-notify — service-to-service notifier for invoice events.
//
// Called from portal-invoice and resend-invoice-webhook after an event is
// persisted to customer_invoice_events. Inserts rows into user_notifications
// (drives the top-bar bell + realtime toast) and sends an SMS via
// telnyx-send-sms to each staff recipient with a phone on file.
//
// Auth: requires Bearer <service role key> in Authorization header. Fire-and
// forget from callers (never block the customer response on this).

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type NotifType = "invoice_viewed" | "invoice_action" | "invoice_paid" | "invoice_bounced";

interface Payload {
  tenant_id: string;
  pitch_invoice_id: string;
  event_type: string; // matches customer_invoice_events.event_type
  actor_summary?: string | null; // optional descriptor for SMS body
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapEvent(evt: string): { type: NotifType; icon: string; title: string; verb: string } | null {
  switch (evt) {
    case "invoice_viewed":
      return { type: "invoice_viewed", icon: "👀", title: "Invoice viewed", verb: "was viewed by the customer" };
    case "invoice_downloaded":
      return { type: "invoice_action", icon: "⬇️", title: "Invoice downloaded", verb: "was downloaded by the customer" };
    case "payment_link_clicked":
      return { type: "invoice_action", icon: "💳", title: "Payment link clicked", verb: "payment link was clicked" };
    case "invoice_paid_seen":
      return { type: "invoice_paid", icon: "✅", title: "Invoice paid", verb: "was marked paid" };
    case "invoice_email_bounced":
      return { type: "invoice_bounced", icon: "⚠️", title: "Invoice email bounced", verb: "email bounced — check the address" };
    case "invoice_email_complained":
      return { type: "invoice_bounced", icon: "⚠️", title: "Invoice email complaint", verb: "email was flagged as spam" };
    case "invoice_email_failed":
      return { type: "invoice_bounced", icon: "⚠️", title: "Invoice email failed", verb: "email failed to send" };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token !== SERVICE_ROLE) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: Payload;
  try { body = await req.json() as Payload; }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const { tenant_id, pitch_invoice_id, event_type } = body;
  if (!tenant_id || !pitch_invoice_id || !event_type) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const mapped = mapEvent(event_type);
  if (!mapped) return json({ ok: true, ignored: true, reason: "unmapped_event" });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Load invoice + project context.
  const { data: invoice } = await supabase
    .from("invoice_ar_mirror")
    .select("id, tenant_id, project_id, doc_number, balance, total_amount")
    .eq("id", pitch_invoice_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (!invoice) return json({ ok: false, error: "invoice_not_found" }, 404);

  let projectName = "";
  let recipients: string[] = [];
  if (invoice.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_manager_id, created_by")
      .eq("id", invoice.project_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();
    if (project) {
      projectName = project.name ?? "";
      for (const id of [project.project_manager_id, project.created_by]) {
        if (id && !recipients.includes(id)) recipients.push(id);
      }
    }
  }

  // Fallback: tenant owner/admins so at least someone is notified.
  if (recipients.length === 0) {
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenant_id)
      .in("role", ["owner", "admin", "manager"])
      .limit(5);
    recipients = (admins ?? []).map((r: any) => r.id).filter(Boolean);
  }

  if (recipients.length === 0) return json({ ok: true, notified: 0, reason: "no_recipients" });

  // Load recipient phones.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, phone")
    .in("id", recipients);

  const docLabel = invoice.doc_number ? `#${invoice.doc_number}` : "";
  const projSuffix = projectName ? ` for ${projectName}` : "";
  const message = `Invoice ${docLabel}${projSuffix} ${mapped.verb}.`.replace(/\s+/g, " ").trim();

  // Insert user_notifications rows (RLS uses service role — bypasses check).
  const notifRows = recipients.map((uid) => ({
    user_id: uid,
    tenant_id,
    type: mapped.type,
    title: mapped.title,
    message,
    icon: mapped.icon,
    metadata: {
      pitch_invoice_id: invoice.id,
      project_id: invoice.project_id,
      doc_number: invoice.doc_number,
      event_type,
    },
    is_read: false,
  }));

  const { error: notifErr } = await supabase.from("user_notifications").insert(notifRows);
  if (notifErr) console.error("[invoice-notify] user_notifications insert failed", notifErr);

  // Fire SMS to each recipient with a phone.
  const smsResults: Array<{ user_id: string; ok: boolean; error?: string }> = [];
  await Promise.all(
    (profiles ?? []).map(async (p: any) => {
      const to = (p?.phone ?? "").trim();
      if (!to) return;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({
            to,
            message,
            tenant_id,
            sent_by: p.id,
          }),
        });
        smsResults.push({ user_id: p.id, ok: res.ok, error: res.ok ? undefined : `status_${res.status}` });
      } catch (e) {
        smsResults.push({ user_id: p.id, ok: false, error: (e as Error).message });
      }
    }),
  );

  return json({ ok: true, notified: recipients.length, sms: smsResults });
});
