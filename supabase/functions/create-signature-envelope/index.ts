import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

interface CreateEnvelopeRequest {
  title: string;
  estimate_id?: string;
  pipeline_entry_id?: string;
  contact_id?: string;
  project_id?: string;
  template_id?: string;
  recipients: Array<{
    name: string;
    email: string;
    role: string;
    signing_order: number;
  }>;
  fields?: Array<{
    field_key: string;
    field_value?: string;
    field_type: string;
    recipient_email?: string;
  }>;
  expires_in_days?: number;
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

    const { 
      title, 
      estimate_id, 
      pipeline_entry_id, 
      contact_id, 
      project_id, 
      template_id,
      recipients, 
      fields = [],
      expires_in_days = 30 
    }: CreateEnvelopeRequest = await req.json();

    // Get user's tenant_id
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "User profile not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const tenantId = profile.tenant_id;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Create the signature envelope
    const { data: envelope, error: envelopeError } = await supabaseClient
      .from('signature_envelopes')
      .insert({
        tenant_id: tenantId,
        title,
        template_id,
        estimate_id,
        pipeline_entry_id,
        contact_id,
        project_id,
        status: 'draft',
        expires_at: expiresAt.toISOString(),
        created_by: user.id
      })
      .select()
      .single();

    if (envelopeError) {
      console.error('Error creating envelope:', envelopeError);
      return new Response(JSON.stringify({ error: "Failed to create envelope" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Create recipients
    const recipientInserts = recipients.map(recipient => ({
      tenant_id: tenantId,
      envelope_id: envelope.id,
      recipient_name: recipient.name,
      recipient_email: recipient.email,
      recipient_role: recipient.role,
      signing_order: recipient.signing_order,
      access_token: crypto.randomUUID().replace(/-/g, '') // Generate unique access token
    }));

    const { data: createdRecipients, error: recipientsError } = await supabaseClient
      .from('signature_recipients')
      .insert(recipientInserts)
      .select();

    if (recipientsError) {
      console.error('Error creating recipients:', recipientsError);
      return new Response(JSON.stringify({ error: "Failed to create recipients" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Create signature fields if provided
    if (fields.length > 0) {
      const fieldInserts = fields.map(field => {
        // Find recipient if specified
        const recipient = createdRecipients?.find(r => r.recipient_email === field.recipient_email);
        
        return {
          tenant_id: tenantId,
          envelope_id: envelope.id,
          field_key: field.field_key,
          field_value: field.field_value || '',
          field_type: field.field_type,
          recipient_id: recipient?.id || null
        };
      });

      const { error: fieldsError } = await supabaseClient
        .from('signature_fields')
        .insert(fieldInserts);

      if (fieldsError) {
        console.error('Error creating fields:', fieldsError);
        // Continue anyway, fields are optional
      }
    }

    // Log envelope creation event
    await supabaseClient.rpc('log_signature_event', {
      p_envelope_id: envelope.id,
      p_recipient_id: null,
      p_event_type: 'created',
      p_description: `Envelope "${title}" created with ${recipients.length} recipients`,
      p_metadata: {
        created_by: user.id,
        recipient_count: recipients.length,
        field_count: fields.length
      }
    });

    console.log('Signature envelope created successfully:', envelope.envelope_number);

    return new Response(JSON.stringify({
      success: true,
      envelope: {
        ...envelope,
        recipients: createdRecipients
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in create-signature-envelope function:", error);
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