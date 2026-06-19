// Edge function: notify-labor-order-scheduled
// Auth mode: internal/trigger route (called from a DB trigger via pg_net).
// Tenant resolution: resolved server-side from the assignment row — never trusted from body.
// Sends email + SMS to the assigned crew and the project's sales rep when a labor order is scheduled.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELNYX_API_KEY = Deno.env.get("TELNYX_API_KEY");
const TELNYX_FROM = Deno.env.get("TELNYX_PHONE_NUMBER");
const APP_URL = Deno.env.get("APP_URL") || "https://pitch-crm.ai";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function fmtDate(d: string | null): string {
  if (!d) return "";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  } catch { return d; }
}

async function sendEmail(templateData: Record<string, any>, recipientEmail: string, idemKey: string) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        templateName: "labor-order-scheduled",
        recipientEmail,
        idempotencyKey: idemKey,
        templateData,
      }),
    });
    if (!res.ok) console.error("email send failed", recipientEmail, res.status, await res.text());
  } catch (e) {
    console.error("email send error", recipientEmail, e);
  }
}

async function sendSms(toPhone: string, body: string) {
  if (!TELNYX_API_KEY || !TELNYX_FROM) {
    console.warn("Telnyx not configured; skipping SMS");
    return;
  }
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: TELNYX_FROM, to: toPhone, text: body }),
    });
    if (!res.ok) console.error("sms send failed", toPhone, res.status, await res.text());
  } catch (e) {
    console.error("sms send error", toPhone, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const assignmentId: string | undefined = body.assignment_id;
    if (!assignmentId) {
      return new Response(JSON.stringify({ ok: false, error: "assignment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve everything server-side from the assignment row
    const { data: assignment, error: aErr } = await supabase
      .from("production_order_assignments")
      .select("id, tenant_id, project_id, title, notes, scheduled_date, status, crew_id, order_type")
      .eq("id", assignmentId)
      .maybeSingle();

    if (aErr || !assignment) {
      console.error("assignment lookup failed", aErr);
      return new Response(JSON.stringify({ ok: false, error: "assignment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (assignment.order_type !== "labor" || assignment.status !== "scheduled" || !assignment.scheduled_date) {
      return new Response(JSON.stringify({ ok: true, skipped: "not a scheduled labor order" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Project + sales rep (sales rep lives on the pipeline_entry → projects.pipeline_entry_id → pipeline_entries.assigned_to)
    let projectName = "";
    let jobNumber = "";
    let address = "";
    let salesRepId: string | null = null;
    if (assignment.project_id) {
      const { data: proj } = await supabase
        .from("projects")
        .select("name, job_number, clj_formatted_number, project_number, pipeline_entry_id")
        .eq("id", assignment.project_id)
        .maybeSingle();
      if (proj) {
        projectName = proj.name || "";
        jobNumber = proj.clj_formatted_number || proj.job_number || proj.project_number || "";
        if (proj.pipeline_entry_id) {
          const { data: pe } = await supabase
            .from("pipeline_entries")
            .select("assigned_to, address_street, address_city, address_state, address_zip")
            .eq("id", proj.pipeline_entry_id)
            .maybeSingle();
          if (pe) {
            salesRepId = pe.assigned_to;
            const parts = [pe.address_street, pe.address_city, pe.address_state, pe.address_zip].filter(Boolean);
            address = parts.join(", ");
          }
        }
      }
    }

    // Crew
    let crewName = "";
    let crewEmail: string | null = null;
    let crewPhone: string | null = null;
    if (assignment.crew_id) {
      const { data: crew } = await supabase
        .from("crews")
        .select("name, email, phone")
        .eq("id", assignment.crew_id)
        .maybeSingle();
      if (crew) {
        crewName = crew.name || "";
        crewEmail = crew.email;
        crewPhone = crew.phone;
      }
    }

    // Sales rep
    let repName = "";
    let repEmail: string | null = null;
    let repPhone: string | null = null;
    if (salesRepId) {
      const { data: rep } = await supabase
        .from("profiles")
        .select("first_name, last_name, email, phone")
        .eq("id", salesRepId)
        .maybeSingle();
      if (rep) {
        repName = `${rep.first_name || ""} ${rep.last_name || ""}`.trim();
        repEmail = rep.email;
        repPhone = rep.phone;
      }
    }

    const scheduledDateFmt = fmtDate(assignment.scheduled_date);
    const idemBase = `labor-order-scheduled-${assignment.id}-${assignment.scheduled_date}`;
    const smsLine = `PITCH CRM: Labor order${jobNumber ? ` #${jobNumber}` : ""} scheduled for ${scheduledDateFmt}${address ? ` @ ${address}` : ""}.${crewName ? ` Crew: ${crewName}.` : ""} ${APP_URL}`;

    const sends: Promise<any>[] = [];

    if (crewEmail) {
      sends.push(sendEmail({
        recipientName: crewName, recipientRole: "crew", jobNumber, projectName,
        address, scheduledDate: scheduledDateFmt, crewName, orderTitle: assignment.title, notes: assignment.notes,
      }, crewEmail, `${idemBase}-crew-email`));
    }
    if (crewPhone) sends.push(sendSms(crewPhone, smsLine));

    if (repEmail) {
      sends.push(sendEmail({
        recipientName: repName, recipientRole: "sales_rep", jobNumber, projectName,
        address, scheduledDate: scheduledDateFmt, crewName, orderTitle: assignment.title, notes: assignment.notes,
      }, repEmail, `${idemBase}-rep-email`));
    }
    if (repPhone) sends.push(sendSms(repPhone, smsLine));

    await Promise.all(sends);

    return new Response(JSON.stringify({
      ok: true,
      data: {
        assignment_id: assignment.id,
        notified: { crewEmail: !!crewEmail, crewSms: !!crewPhone, repEmail: !!repEmail, repSms: !!repPhone },
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("notify-labor-order-scheduled error", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
