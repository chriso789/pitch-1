import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

interface LaborItem {
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
}

interface CompanyInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  license_number?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { 
      estimateId, 
      laborItems, 
      totalAmount, 
      customerName, 
      projectAddress,
      companyInfo,
      crewEmail,
      crewName
    } = await req.json();

    console.log('Processing labor order email:', { estimateId, crewEmail, crewName });

    if (!crewEmail) {
      throw new Error('Crew email is required');
    }

    // Generate email content
    const itemsHTML = (laborItems as LaborItem[]).map(item => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; text-align: left;">${item.item_name}</td>
        <td style="padding: 12px; text-align: center;">${item.qty.toFixed(1)}</td>
        <td style="padding: 12px; text-align: center;">${item.unit}</td>
        <td style="padding: 12px; text-align: right;">$${item.unit_cost.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; font-weight: bold;">$${item.line_total.toFixed(2)}</td>
      </tr>
    `).join('');

    const company = companyInfo as CompanyInfo || {};
    const companyHeader = company.name ? `
      <div style="text-align: right; font-size: 12px; color: #6b7280; margin-bottom: 10px;">
        <strong style="font-size: 14px; color: #374151;">${company.name}</strong><br>
        ${company.phone ? `Tel: ${company.phone}<br>` : ''}
        ${company.email ? `Email: ${company.email}<br>` : ''}
        ${company.license_number ? `License: ${company.license_number}` : ''}
      </div>
    ` : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f9fafb;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          ${companyHeader}
          <div style="background: linear-gradient(135deg, #34d399 0%, #059669 100%); padding: 32px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Labor Order</h1>
            <p style="color: #d1fae5; margin: 8px 0 0 0; font-size: 16px;">Ref #${estimateId.slice(-8).toUpperCase()}</p>
          </div>
          
          <div style="padding: 32px;">
            <p style="margin: 0 0 16px 0; font-size: 16px;">Hello ${crewName || 'Team'},</p>
            
            <p style="margin: 0 0 24px 0; font-size: 15px;">
              ${company.name ? `<strong>${company.name}</strong> has` : 'We have'} a new labor order for you. Please review the details below.
            </p>

            <div style="background-color: #ecfdf5; border-radius: 6px; padding: 16px; margin-bottom: 24px; border-left: 4px solid #34d399;">
              <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #065f46;">📍 Job Site</h3>
              ${customerName ? `<p style="margin: 0; font-size: 14px;"><strong>Customer:</strong> ${customerName}</p>` : ''}
              ${projectAddress ? `<p style="margin: 4px 0 0 0; font-size: 14px;"><strong>Address:</strong> ${projectAddress}</p>` : ''}
            </div>

            <h3 style="margin: 24px 0 12px 0; font-size: 18px; color: #374151;">Labor Items</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <thead>
                <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                  <th style="padding: 12px; text-align: left; font-weight: 600;">Description</th>
                  <th style="padding: 12px; text-align: center; font-weight: 600;">Qty</th>
                  <th style="padding: 12px; text-align: center; font-weight: 600;">Unit</th>
                  <th style="padding: 12px; text-align: right; font-weight: 600;">Rate</th>
                  <th style="padding: 12px; text-align: right; font-weight: 600;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHTML}
              </tbody>
              <tfoot>
                <tr style="background-color: #f9fafb; font-weight: bold;">
                  <td colspan="4" style="padding: 12px; text-align: right;">Total Labor Cost:</td>
                  <td style="padding: 12px; text-align: right; color: #059669; font-size: 16px;">$${totalAmount.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>

            <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
              Please confirm receipt of this labor order and let us know if you have any questions.
            </p>
            
            <p style="margin: 16px 0 0 0; font-size: 14px;">
              Best regards,<br>
              <strong>${company.name || 'PITCH CRM'}</strong>
              ${company.phone ? `<br>Tel: ${company.phone}` : ''}
            </p>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #6b7280;">
              ${company.name ? `Sent by ${company.name} via PITCH CRM` : 'Sent via PITCH CRM'}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend
    const fromEmail = company.email && company.email.includes('@') 
      ? `${company.name || 'PITCH CRM'} <${company.email}>`
      : `PITCH CRM <orders@resend.dev>`;

    const emailResponse = await resend.emails.send({
      from: fromEmail,
      to: [crewEmail],
      subject: `Labor Order - ${customerName || 'New Job'} ${projectAddress ? `| ${projectAddress}` : ''}`,
      html: html,
    });

    console.log('Email sent successfully:', emailResponse);

    // Log to communication history
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await serviceClient
      .from('communication_history')
      .insert({
        type: 'email',
        direction: 'outbound',
        recipient: crewEmail,
        subject: `Labor Order - ${customerName || 'New Job'}`,
        body: html,
        status: 'sent',
        metadata: {
          estimateId,
          crewName,
          laborOrderEmail: true,
          companyName: company.name
        }
      });

    return new Response(
      JSON.stringify({ success: true, messageId: emailResponse.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in labor-order-send-email:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});