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
    const companyLogo = branding?.logo_url || null;
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'reports@pitchcrm.io';

    // If no logo in branding snapshot, try to fetch from tenant
    let logoUrl = companyLogo;
    if (!logoUrl) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('logo_url')
        .eq('id', tenantId)
        .single();
      logoUrl = tenantRow?.logo_url || null;
    }

    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 48px; max-width: 200px; margin-bottom: 12px;" /><br>`
      : '';

    // Build footer contact parts
    const footerParts: string[] = [];
    if (branding?.phone) footerParts.push(branding.phone);
    if (branding?.email) footerParts.push(branding.email);
    const footerLine = footerParts.join(' &nbsp;•&nbsp; ');

    // Send via Resend
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header with logo & company name -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); padding: 32px 40px; text-align: center;">
              ${logoHtml}
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 600;">${companyName}</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="color: #1f2937; margin: 0 0 20px; font-size: 20px;">Your Report Package is Ready</h2>
              
              <div style="white-space: pre-line; margin-bottom: 25px; color: #374151; font-size: 15px; line-height: 1.6;">${emailBody || 'Please review your report and estimate package by clicking the button below.'}</div>
              
              <table role="presentation" style="width: 100%; margin: 30px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${viewUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                      View Your Report
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 25px; line-height: 1.5;">
                If you have any questions, please don't hesitate to contact us.
              </p>
            </td>
          </tr>
          
          <!-- Footer with company info -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #374151; font-size: 13px; font-weight: 600;">${companyName}</p>
              ${footerLine ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 12px;">${footerLine}</p>` : ''}
              ${branding?.website ? `<p style="margin: 4px 0 0; color: #9ca3af; font-size: 12px;">${branding.website}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
