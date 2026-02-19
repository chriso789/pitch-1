import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
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

    // Deduplicate: check if "opened" event already exists for this envelope
    const { data: existingEvent } = await supabase
      .from("signature_events")
      .select("id")
      .eq("envelope_id", envelope.id)
      .eq("event_type", "opened")
      .limit(1)
      .maybeSingle();

    if (existingEvent) {
      console.log("Opened event already exists, skipping SMS");
      return new Response(JSON.stringify({ success: true, already_notified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the opened event
    await supabase.from("signature_events").insert({
      envelope_id: envelope.id,
      tenant_id: envelope.tenant_id,
      event_type: "opened",
      event_description: `${recipient.recipient_name} opened the signing page`,
      event_metadata: {
        recipient_id: recipient.id,
        recipient_name: recipient.recipient_name,
      },
    });

    // Get the creator's phone number from profiles
    if (!envelope.created_by) {
      console.log("No created_by on envelope, skipping SMS");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: creatorProfile } = await supabase
      .from("profiles")
      .select("phone, first_name, last_name")
      .eq("id", envelope.created_by)
      .single();

    if (!creatorProfile?.phone) {
      console.log("Creator has no phone number, skipping SMS");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build notification message
    const docTitle = envelope.title || "a document";
    const message = `🔔 ${recipient.recipient_name} just opened their signature request for ${docTitle}!`;

    // Send SMS via telnyx-send-sms using direct fetch with tenant_id
    try {
      const smsResponse = await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: creatorProfile.phone,
          message,
          tenant_id: envelope.tenant_id,
          sent_by: envelope.created_by,
        }),
      });
      console.log(`SMS notification sent to ${creatorProfile.phone}, status: ${smsResponse.status}`);
    } catch (smsError) {
      console.error("Failed to send SMS notification:", smsError);
      // Don't fail the request over SMS
    }

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
