import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestSignatureBody {
  token: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: RequestSignatureBody = await req.json();
    const { token } = body;

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Token required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[request-quote-signature] Processing token:", token);

    // Find tracking link by token
    const { data: trackingLink, error: linkError } = await supabase
      .from("quote_tracking_links")
      .select(`
        *,
        enhanced_estimates (
          id,
          estimate_number,
          pipeline_entry_id,
          pdf_url
        ),
        contacts (
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq("token", token)
      .eq("is_active", true)
      .single();

    if (linkError || !trackingLink) {
      console.error("[request-quote-signature] Tracking link not found:", linkError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired quote link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiration
    if (trackingLink.expires_at && new Date(trackingLink.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: "Quote link has expired" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = trackingLink.tenant_id;
    const estimateId = trackingLink.estimate_id;
    const contactId = trackingLink.contact_id;
    const contact = trackingLink.contacts;
    const estimate = trackingLink.enhanced_estimates;

    if (!estimate) {
      return new Response(
        JSON.stringify({ success: false, error: "No estimate found for this quote" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare recipient info
    const recipientName = contact 
      ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
      : trackingLink.recipient_name || 'Customer';
    
    const recipientEmail = contact?.email || trackingLink.recipient_email;
    
    if (!recipientEmail) {
      return new Response(
        JSON.stringify({ success: false, error: "No email address found for signature request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[request-quote-signature] Creating envelope for:", {
      estimateId,
      recipientName,
      recipientEmail
    });

    // Check if an envelope already exists for this estimate that is still valid
    const { data: existingEnvelope } = await supabase
      .from("signature_envelopes")
      .select(`
        id,
        status,
        recipients:signature_recipients(
          id,
          access_token,
          status
        )
      `)
      .eq("estimate_id", estimateId)
      .in("status", ["draft", "sent", "partially_signed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEnvelope && existingEnvelope.recipients?.length > 0) {
      const recipient = existingEnvelope.recipients[0];
      if (recipient.access_token && recipient.status !== "signed") {
        console.log("[request-quote-signature] Returning existing envelope:", existingEnvelope.id);
        return new Response(
          JSON.stringify({
            success: true,
            access_token: recipient.access_token,
            envelope_id: existingEnvelope.id,
            existing: true
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create new signature envelope
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data: envelope, error: envelopeError } = await supabase
      .from("signature_envelopes")
      .insert({
        tenant_id: tenantId,
        title: `Quote #${estimate.estimate_number} - Acceptance`,
        estimate_id: estimateId,
        pipeline_entry_id: estimate.pipeline_entry_id,
        contact_id: contactId,
        status: "sent",
        sent_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        created_by: trackingLink.sent_by
      })
      .select()
      .single();

    if (envelopeError) {
      console.error("[request-quote-signature] Envelope creation error:", envelopeError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create signature envelope" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create recipient with access token
    const accessToken = crypto.randomUUID().replace(/-/g, '');

    const { data: recipient, error: recipientError } = await supabase
      .from("signature_recipients")
      .insert({
        tenant_id: tenantId,
        envelope_id: envelope.id,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        recipient_role: "customer",
        signing_order: 1,
        access_token: accessToken,
        status: "sent"
      })
      .select()
      .single();

    if (recipientError) {
      console.error("[request-quote-signature] Recipient creation error:", recipientError);
      // Try to clean up the envelope
      await supabase.from("signature_envelopes").delete().eq("id", envelope.id);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create signature recipient" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the event
    await supabase.rpc("log_signature_event", {
      p_envelope_id: envelope.id,
      p_recipient_id: recipient.id,
      p_event_type: "created",
      p_description: `Signature envelope created from quote view for ${recipientName}`,
      p_metadata: {
        quote_token: token,
        tracking_link_id: trackingLink.id,
        estimate_number: estimate.estimate_number
      }
    }).catch(err => {
      console.warn("[request-quote-signature] Failed to log event:", err);
    });

    console.log("[request-quote-signature] Envelope created successfully:", {
      envelope_id: envelope.id,
      access_token: accessToken
    });

    return new Response(
      JSON.stringify({
        success: true,
        access_token: accessToken,
        envelope_id: envelope.id,
        envelope_number: envelope.envelope_number
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[request-quote-signature] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
