import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

interface SendEnvelopeRequest {
  envelope_id: string;
  email_subject?: string;
  email_message?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization header required" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Authentication failed" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { envelope_id, email_subject, email_message }: SendEnvelopeRequest = await req.json();

    // Get the envelope with recipients
    const { data: envelope, error: envelopeError } = await supabaseClient
      .from('signature_envelopes')
      .select(`
        *,
        recipients:signature_recipients(*)
      `)
      .eq('id', envelope_id)
      .single();

    if (envelopeError || !envelope) {
      return new Response(JSON.stringify({ error: "Envelope not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (envelope.status !== 'draft') {
      return new Response(JSON.stringify({ error: "Envelope has already been sent" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate the PDF document first
    const pdfResponse = await supabaseClient.functions.invoke('generate-estimate-pdf', {
      body: {
        estimate_id: envelope.estimate_id,
        pipeline_entry_id: envelope.pipeline_entry_id,
        template_data: null
      }
    });

    if (pdfResponse.error) {
      console.error('Error generating PDF:', pdfResponse.error);
      return new Response(JSON.stringify({ error: "Failed to generate document" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { document: generatedDoc } = pdfResponse.data;

    // Update envelope with generated document path
    await supabaseClient
      .from('signature_envelopes')
      .update({
        generated_pdf_path: generatedDoc.file_name,
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', envelope_id);

    // Update recipients status to 'sent' and generate access tokens
    const recipientUpdates = envelope.recipients.map((recipient: any) => ({
      id: recipient.id,
      status: 'sent',
      access_token: recipient.access_token || crypto.randomUUID().replace(/-/g, '')
    }));

    for (const update of recipientUpdates) {
      await supabaseClient
        .from('signature_recipients')
        .update({
          status: update.status,
          access_token: update.access_token
        })
        .eq('id', update.id);
    }

    // Look up sender profile for name/reply-to
    const { data: senderProfile } = await supabaseClient
      .from('profiles')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .maybeSingle();

    const senderName = senderProfile
      ? `${senderProfile.first_name ?? ''} ${senderProfile.last_name ?? ''}`.trim() || 'Your Contractor'
      : 'Your Contractor';
    const senderEmail = senderProfile?.email || user.email;

    // Actually send emails via Resend through email-signature-request
    for (const recipient of envelope.recipients) {
      const updated = recipientUpdates.find((u) => u.id === recipient.id);
      const accessToken = updated?.access_token || recipient.access_token;

      const { error: emailError } = await supabaseClient.functions.invoke(
        'email-signature-request',
        {
          body: {
            envelope_id,
            recipient_id: recipient.id,
            recipient_name: recipient.recipient_name,
            recipient_email: recipient.recipient_email,
            access_token: accessToken,
            sender_name: senderName,
            sender_email: senderEmail,
            subject: email_subject || `Please sign: ${envelope.title}`,
            message: email_message || '',
            // Always BCC support so we can verify delivery
            bcc: ['support@pitch-crm.ai'],
          },
        }
      );

      if (emailError) {
        console.error(`Failed to email ${recipient.recipient_email}:`, emailError);
      }

      // Log email sent event
      await supabaseClient.rpc('log_signature_event', {
        p_envelope_id: envelope_id,
        p_recipient_id: recipient.id,
        p_event_type: 'sent',
        p_description: `Signing invitation sent to ${recipient.recipient_email}`,
        p_metadata: {
          recipient_email: recipient.recipient_email,
          email_error: emailError ? String(emailError) : null,
        },
      });
    }

    // Log envelope sent event
    await supabaseClient.rpc('log_signature_event', {
      p_envelope_id: envelope_id,
      p_recipient_id: null,
      p_event_type: 'sent',
      p_description: `Envelope sent to ${envelope.recipients.length} recipients`,
      p_metadata: {
        sent_by: user.id,
        recipient_count: envelope.recipients.length,
        document_path: generatedDoc.file_name
      }
    });

    console.log('Signature envelope sent successfully:', envelope.envelope_number);

    return new Response(JSON.stringify({
      success: true,
      envelope_number: envelope.envelope_number,
      recipients_notified: envelope.recipients.length,
      document_generated: generatedDoc.file_name
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in send-signature-envelope function:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : String(error) 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

Deno.serve(handler);