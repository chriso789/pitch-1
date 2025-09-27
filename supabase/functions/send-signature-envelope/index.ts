import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
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

    // Send emails to recipients (in a real implementation, you'd use a proper email service)
    for (const recipient of envelope.recipients) {
      const signingUrl = `${Deno.env.get('SUPABASE_URL')?.replace('/v1', '')}/sign/${recipient.access_token}`;
      
      // In production, implement actual email sending here
      console.log(`Would send email to ${recipient.recipient_email}:`);
      console.log(`Subject: ${email_subject || `Please sign: ${envelope.title}`}`);
      console.log(`Signing URL: ${signingUrl}`);
      
      // Log email sent event
      await supabaseClient.rpc('log_signature_event', {
        p_envelope_id: envelope_id,
        p_recipient_id: recipient.id,
        p_event_type: 'sent',
        p_description: `Signing invitation sent to ${recipient.recipient_email}`,
        p_metadata: {
          recipient_email: recipient.recipient_email,
          signing_url: signingUrl
        }
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
        error: error.message 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);