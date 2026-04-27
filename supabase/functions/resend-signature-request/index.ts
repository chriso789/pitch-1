import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  envelope_id: string;
  recipient_id?: string; // optional - if omitted, reminds all unsigned recipients
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: RequestBody = await req.json();
    const { envelope_id, recipient_id } = body;

    if (!envelope_id) {
      return new Response(JSON.stringify({ error: "envelope_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load envelope with recipients
    const { data: envelope, error: envError } = await supabase
      .from("signature_envelopes")
      .select("*, recipients:signature_recipients(*)")
      .eq("id", envelope_id)
      .single();

    if (envError || !envelope) {
      return new Response(
        JSON.stringify({ error: "Envelope not found", details: envError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine sender from created_by
    let senderName = "Your Contractor";
    let senderEmail: string | undefined;
    if (envelope.created_by) {
      const { data: senderProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", envelope.created_by)
        .single();
      if (senderProfile) {
        senderName = senderProfile.full_name || senderName;
        senderEmail = senderProfile.email || undefined;
      }
    }

    // Filter recipients: those who haven't signed yet
    const recipients = (envelope.recipients || []).filter((r: any) => {
      if (recipient_id) return r.id === recipient_id;
      return r.status !== "signed" && r.status !== "completed";
    });

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ error: "No pending recipients to remind" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subject = `Reminder: Please sign "${envelope.title}"`;
    const message =
      envelope.email_message ||
      `This is a friendly reminder to review and sign "${envelope.title}". Thanks!`;

    const results: any[] = [];
    for (const recipient of recipients) {
      if (!recipient.recipient_email || !recipient.access_token) {
        results.push({ recipient_id: recipient.id, ok: false, error: "missing email or token" });
        continue;
      }

      const { data, error } = await supabase.functions.invoke("email-signature-request", {
        body: {
          envelope_id,
          recipient_id: recipient.id,
          recipient_name: recipient.recipient_name,
          recipient_email: recipient.recipient_email,
          access_token: recipient.access_token,
          sender_name: senderName,
          sender_email: senderEmail,
          subject,
          message,
          is_reminder: true,
        },
      });

      if (error) {
        results.push({ recipient_id: recipient.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      } else {
        results.push({ recipient_id: recipient.id, ok: true, data });

        // Log reminder sent event (best-effort)
        const { error: logError } = await supabase.rpc("log_envelope_event", {
          p_envelope_id: envelope_id,
          p_recipient_id: recipient.id,
          p_event_type: "reminder_sent",
          p_description: `Reminder sent to ${recipient.recipient_email}`,
          p_metadata: {},
        });
        if (logError) console.warn("Failed to log reminder event:", logError.message);
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return new Response(
      JSON.stringify({ success: okCount > 0, sent: okCount, results }),
      {
        status: okCount > 0 ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("resend-signature-request error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
