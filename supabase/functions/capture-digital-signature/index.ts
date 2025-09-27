import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

interface CaptureSignatureRequest {
  access_token: string;
  signature_data: string; // Base64 encoded signature image
  field_id?: string;
  ip_address?: string;
  user_agent?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { 
      access_token, 
      signature_data, 
      field_id,
      ip_address,
      user_agent 
    }: CaptureSignatureRequest = await req.json();

    // Find the recipient by access token
    const { data: recipient, error: recipientError } = await supabaseClient
      .from('signature_recipients')
      .select(`
        *,
        envelope:signature_envelopes(*)
      `)
      .eq('access_token', access_token)
      .single();

    if (recipientError || !recipient) {
      return new Response(JSON.stringify({ error: "Invalid access token" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (recipient.status === 'signed') {
      return new Response(JSON.stringify({ error: "Document already signed by this recipient" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate signature hash for verification
    const signatureHash = await generateSignatureHash(signature_data, recipient.id);

    // Create the digital signature record
    const { data: digitalSignature, error: signatureError } = await supabaseClient
      .from('digital_signatures')
      .insert({
        tenant_id: recipient.tenant_id,
        envelope_id: recipient.envelope_id,
        recipient_id: recipient.id,
        field_id: field_id || null,
        signature_data,
        signature_hash: signatureHash,
        signature_metadata: {
          ip_address,
          user_agent,
          timestamp: new Date().toISOString(),
          recipient_email: recipient.recipient_email,
          recipient_name: recipient.recipient_name
        },
        ip_address
      })
      .select()
      .single();

    if (signatureError) {
      console.error('Error creating digital signature:', signatureError);
      return new Response(JSON.stringify({ error: "Failed to capture signature" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Update recipient status
    await supabaseClient
      .from('signature_recipients')
      .update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        ip_address,
        user_agent
      })
      .eq('id', recipient.id);

    // Check if all recipients have signed
    const { data: allRecipients } = await supabaseClient
      .from('signature_recipients')
      .select('status')
      .eq('envelope_id', recipient.envelope_id);

    const allSigned = allRecipients?.every(r => r.status === 'signed') || false;

    // Update envelope status if all signed
    if (allSigned) {
      await supabaseClient
        .from('signature_envelopes')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', recipient.envelope_id);

      // Log completion event
      await supabaseClient.rpc('log_signature_event', {
        p_envelope_id: recipient.envelope_id,
        p_recipient_id: null,
        p_event_type: 'completed',
        p_description: `All recipients have signed the document`,
        p_metadata: {
          completed_at: new Date().toISOString(),
          total_signatures: allRecipients?.length || 0
        }
      });
    }

    // Log signature event
    await supabaseClient.rpc('log_signature_event', {
      p_envelope_id: recipient.envelope_id,
      p_recipient_id: recipient.id,
      p_event_type: 'signed',
      p_description: `Document signed by ${recipient.recipient_name}`,
      p_metadata: {
        signature_id: digitalSignature.id,
        ip_address,
        user_agent: user_agent?.substring(0, 200) // Truncate long user agents
      }
    });

    console.log('Digital signature captured successfully for:', recipient.recipient_email);

    return new Response(JSON.stringify({
      success: true,
      signature_id: digitalSignature.id,
      envelope_status: allSigned ? 'completed' : 'partially_signed',
      all_signed: allSigned
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in capture-digital-signature function:", error);
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

// Generate a cryptographic hash for signature verification
async function generateSignatureHash(signatureData: string, recipientId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureData + recipientId + Date.now().toString());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(handler);