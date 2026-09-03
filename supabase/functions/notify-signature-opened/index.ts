import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { notifySenderEngagement } from '../_shared/engagement-notify.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { access_token } = await req.json();
    if (!access_token) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the recipient + envelope
    const { data: recipient, error: recipientError } = await supabase
      .from("signature_recipients")
      .select("id, recipient_name, envelope_id, signature_envelopes(id, tenant_id, title, created_by, estimate_id)")
      .eq("access_token", access_token)
      .single();

    if (recipientError || !recipient) {
      console.log("Recipient not found for token, skipping notification");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envelope = recipient.signature_envelopes as any;
    if (!envelope) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the opened event (every open)
    const { count: priorOpens } = await supabase
      .from("signature_events")
      .select("id", { count: "exact", head: true })
      .eq("envelope_id", envelope.id)
      .eq("event_type", "opened");

    const openNumber = (priorOpens || 0) + 1;

    await supabase.from("signature_events").insert({
      envelope_id: envelope.id,
      tenant_id: envelope.tenant_id,
      event_type: "opened",
      event_description: `${recipient.recipient_name} opened the signing page`,
      event_metadata: {
        recipient_id: recipient.id,
        recipient_name: recipient.recipient_name,
        open_number: openNumber,
      },
    });

    if (!envelope.created_by) {
      console.log("No created_by on envelope, skipping notification");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docTitle = envelope.title || "a document";
    const title = openNumber > 1 ? "Envelope Reopened" : "Envelope Opened";
    const message = `🔔 ${recipient.recipient_name} opened "${docTitle}"${openNumber > 1 ? ` (open #${openNumber})` : ""}`;

    await notifySenderEngagement({
      supabase,
      tenantId: envelope.tenant_id,
      userId: envelope.created_by,
      type: "envelope_viewed",
      title,
      message,
      emailSubject: `${title}: ${docTitle}`,
      detailLines: [
        `Recipient: ${recipient.recipient_name}`,
        `Document: ${docTitle}`,
        `Open #${openNumber}`,
      ],
      actionUrl: `${Deno.env.get("PUBLIC_APP_URL") || "https://pitch-crm.ai"}/signature-envelopes/${envelope.id}`,
      metadata: {
        envelope_id: envelope.id,
        recipient_id: recipient.id,
        action_url: `/signature-envelopes/${envelope.id}`,
        open_number: openNumber,
      },
    });


    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in notify-signature-opened:", error);
    // Always return success to never block page load
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
