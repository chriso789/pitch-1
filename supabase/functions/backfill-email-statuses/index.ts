import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ResendEmail {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user }, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull all emails missing terminal status with a resend_message_id (or
    // metadata.email_id) so we can backfill.
    const { data: rows, error } = await supabase
      .from("communication_history")
      .select("id, tenant_id, contact_id, resend_message_id, metadata, email_status, delivered_at, opened_at, bounced_at, opened_count, clicked_count, to_address")
      .eq("communication_type", "email")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    let checked = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows || []) {
      const emailId = row.resend_message_id ||
        (row.metadata as Record<string, unknown> | null)?.email_id as string | undefined;
      if (!emailId) continue;
      checked++;

      try {
        const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
          headers: { Authorization: `Bearer ${resendKey}` },
        });
        if (!res.ok) {
          errors.push(`${emailId}: ${res.status}`);
          continue;
        }
        const data = await res.json() as ResendEmail & {
          last_event?: string;
          delivered_at?: string;
          opened_at?: string;
          clicked_at?: string;
          bounced_at?: string;
          to?: string[];
        };

        const update: Record<string, unknown> = {};

        // Backfill resend_message_id if it was only in metadata
        if (!row.resend_message_id) update.resend_message_id = emailId;

        // Backfill to_address from Resend payload if missing
        const toAddr = row.to_address || data.to?.[0] || null;
        if (!row.to_address && data.to?.[0]) update.to_address = data.to[0];

        // Link to lead/contact by email if missing
        if (!row.contact_id && toAddr) {
          let q = supabase
            .from("contacts")
            .select("id")
            .ilike("email", toAddr)
            .limit(1);
          if (row.tenant_id) q = q.eq("tenant_id", row.tenant_id);
          const { data: matched } = await q.maybeSingle();
          if (matched?.id) update.contact_id = matched.id;
        }

        // Map last_event -> status
        const evt = (data.last_event || "").toLowerCase();
        if (evt) {
          const statusMap: Record<string, string> = {
            sent: "sent",
            delivered: "delivered",
            opened: "opened",
            clicked: "clicked",
            bounced: "bounced",
            complained: "complained",
            delivery_delayed: "delayed",
            failed: "failed",
          };
          const mapped = statusMap[evt];
          if (mapped) update.email_status = mapped;
        }

        if (data.delivered_at && !row.delivered_at) update.delivered_at = data.delivered_at;
        if (data.opened_at && !row.opened_at) {
          update.opened_at = data.opened_at;
          if (!row.opened_count) update.opened_count = 1;
        }
        if (data.bounced_at && !row.bounced_at) {
          update.bounced_at = data.bounced_at;
          update.email_status = "bounced";
        }

        // If we have any successful response and no terminal status, treat as
        // at least 'sent' so the dashboard reflects reality.
        if (!update.email_status && row.email_status === "sent" && !data.last_event) {
          // leave as sent
        }

        // Sync delivery_status (carrier-style) for UI consistency
        if (update.email_status === "delivered" || update.email_status === "opened" || update.email_status === "clicked") {
          update.delivery_status = "delivered";
        } else if (update.email_status === "bounced" || update.email_status === "failed") {
          update.delivery_status = "failed";
        } else if (update.email_status === "sent") {
          update.delivery_status = "sent";
        }

        if (Object.keys(update).length > 0) {
          update.delivery_status_updated_at = new Date().toISOString();
          const { error: upErr } = await supabase
            .from("communication_history")
            .update(update)
            .eq("id", row.id);
          if (upErr) {
            errors.push(`${row.id}: ${upErr.message}`);
          } else {
            updated++;
          }
        }
      } catch (e) {
        errors.push(`${emailId}: ${(e as Error).message}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, checked, updated, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
