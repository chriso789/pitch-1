// ============================================================================
// REPORT PACKET SEND VIA RESEND
// Sends packet via email with tracking link
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendRequest {
  packet_id: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing authorization' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid user' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: tenantId } = await anonClient.rpc('get_user_active_tenant_id');
    if (!tenantId) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NO_TENANT', message: 'No active tenant' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: SendRequest = await req.json();
    const { packet_id, to, cc, subject, body: emailBody } = body;

    if (!packet_id || !to || to.length === 0 || !subject) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'packet_id, to, and subject required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch packet
    const { data: packet, error: packetError } = await supabase
      .from('report_packets')
      .select('*')
      .eq('id', packet_id)
      .eq('tenant_id', tenantId)
      .single();

    if (packetError || !packet) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Packet not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if PDF exists
    if (!packet.final_pdf_storage_path) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NO_PDF', message: 'Generate PDF first before sending' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get or create viewer token
    let viewerToken: string;
    const { data: existingViewer } = await supabase
      .from('report_packet_viewers')
      .select('viewer_token')
      .eq('packet_id', packet_id)
      .eq('email', to[0])
      .single();

    if (existingViewer) {
      viewerToken = existingViewer.viewer_token;
    } else {
      // Generate secure token
      const tokenBytes = crypto.getRandomValues(new Uint8Array(24));
      viewerToken = btoa(String.fromCharCode(...tokenBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      await supabase.from('report_packet_viewers').insert({
        tenant_id: tenantId,
        packet_id,
        viewer_token: viewerToken,
        email: to[0]
      });
    }

    // Build view URL
    const appUrl = Deno.env.get('APP_URL') || 'https://app.pitchcrm.io';
    const viewUrl = `${appUrl}/r/${viewerToken}`;

    // Get branding for email
    const branding = packet.branding_snapshot as Record<string, string>;
    const companyName = branding?.company_name || 'Your Contractor';
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'reports@pitchcrm.io';

    // Send via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'CONFIG_ERROR', message: 'Resend not configured' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #2563eb, #1e40af); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${companyName}</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #1f2937; margin-top: 0;">Your Report Package is Ready</h2>
    
    <div style="white-space: pre-line; margin-bottom: 25px;">${emailBody || 'Please review your report and estimate package by clicking the button below.'}</div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${viewUrl}" style="background: #2563eb; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
        View Your Report
      </a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
      If you have any questions, please don't hesitate to contact us.
    </p>
  </div>
  
  <div style="background: #1f2937; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #9ca3af; margin: 0; font-size: 12px;">
      ${branding?.phone ? branding.phone + ' | ' : ''}${branding?.email || ''}
      ${branding?.website ? '<br>' + branding.website : ''}
    </p>
  </div>
</body>
</html>`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${companyName} <${fromEmail}>`,
        to,
        cc,
        subject,
        html: emailHtml
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend error:', resendData);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'EMAIL_ERROR', message: 'Failed to send email', details: resendData } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update packet status
    await supabase
      .from('report_packets')
      .update({
        status: 'sent',
        updated_at: new Date().toISOString()
      })
      .eq('id', packet_id);

    // Log event
    await supabase.from('report_packet_events').insert({
      tenant_id: tenantId,
      packet_id,
      event_type: 'email_sent',
      actor_type: 'internal_user',
      actor_user_id: user.id,
      meta: {
        resend_message_id: resendData.id,
        to,
        cc,
        subject,
        view_url: viewUrl
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          packet_id,
          resend_message_id: resendData.id,
          view_url: viewUrl,
          sent_to: to
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
