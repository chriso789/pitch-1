import { createClient } from "npm:@supabase/supabase-js@2.49.1";
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
  notes?: string;
  color_specs?: string;
}

interface CompanyInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  license_number?: string;
  logo_url?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const {
      estimateId,
      laborItems,
      customerName,
      projectAddress,
      companyInfo,
      crewEmail,
      crewName,
    } = await req.json();

    if (!crewEmail) throw new Error('Crew email is required');

    const company = (companyInfo as CompanyInfo) || {};
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Resolve tenant_id for tracking record
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    // Insert tracking record up front so we have an id for the pixel
    const { data: tracking, error: trackErr } = await serviceClient
      .from('labor_order_emails')
      .insert({
        estimate_id: estimateId,
        tenant_id: profile?.tenant_id ?? null,
        sent_by: user.id,
        recipient_email: crewEmail,
        recipient_name: crewName ?? null,
        customer_name: customerName ?? null,
        project_address: projectAddress ?? null,
      })
      .select('id')
      .single();

    if (trackErr) throw trackErr;

    const trackingId = tracking.id;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const pixelUrl = `${supabaseUrl}/functions/v1/track-labor-order-open?id=${trackingId}`;

    // Build crew-friendly items table — quantities only, no pricing
    const itemsHTML = (laborItems as LaborItem[]).map((item, idx) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px; text-align: center; color: #6b7280;">${idx + 1}</td>
        <td style="padding: 12px; text-align: left;">
          <div style="font-weight: 600;">${item.item_name}</div>
          ${item.color_specs ? `<div style="font-size: 12px; color: #6b7280;">Color/Notes: ${item.color_specs}</div>` : ''}
          ${item.notes ? `<div style="font-size: 12px; color: #6b7280;">${item.notes}</div>` : ''}
        </td>
        <td style="padding: 12px; text-align: center; font-weight: 600;">${Number(item.qty).toFixed(2)}</td>
        <td style="padding: 12px; text-align: center; color: #374151;">${item.unit || ''}</td>
      </tr>
    `).join('');

    const logoBlock = company.logo_url
      ? `<img src="${company.logo_url}" alt="${company.name ?? ''}" style="max-height: 56px; margin-bottom: 12px;" />`
      : '';

    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f9fafb;">
  <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #34d399 0%, #059669 100%); padding: 28px 32px;">
      ${logoBlock}
      <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: bold;">Crew Work Order</h1>
      <p style="color: #d1fae5; margin: 6px 0 0 0; font-size: 15px;">Ref #${String(estimateId).slice(-8).toUpperCase()}</p>
    </div>

    <div style="padding: 28px 32px;">
      <p style="margin: 0 0 16px 0; font-size: 16px;">Hi ${crewName || 'Team'},</p>
      <p style="margin: 0 0 20px 0; font-size: 15px;">
        ${company.name ? `<strong>${company.name}</strong> has` : 'We have'} a new job for your crew. Below are the items and quantities required on site.
      </p>

      <div style="background-color: #ecfdf5; border-radius: 6px; padding: 14px 16px; margin-bottom: 22px; border-left: 4px solid #34d399;">
        <div style="font-size: 13px; color: #065f46; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Job Site</div>
        ${customerName ? `<div style="margin-top: 4px;"><strong>Customer:</strong> ${customerName}</div>` : ''}
        ${projectAddress ? `<div style="margin-top: 2px;"><strong>Address:</strong> ${projectAddress}</div>` : ''}
      </div>

      <h3 style="margin: 18px 0 10px 0; font-size: 16px; color: #374151;">Scope of Work</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 10px; text-align: center; font-weight: 600; width: 40px;">#</th>
            <th style="padding: 10px; text-align: left; font-weight: 600;">Item</th>
            <th style="padding: 10px; text-align: center; font-weight: 600; width: 80px;">Qty</th>
            <th style="padding: 10px; text-align: center; font-weight: 600; width: 80px;">Unit</th>
          </tr>
        </thead>
        <tbody>${itemsHTML}</tbody>
      </table>

      <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
        Please confirm receipt and reach out with any questions before mobilizing.
      </p>

      <p style="margin: 18px 0 0 0; font-size: 14px;">
        Thanks,<br>
        <strong>${company.name || 'Project Manager'}</strong>
        ${company.phone ? `<br>Tel: ${company.phone}` : ''}
        ${company.email ? `<br>Email: ${company.email}` : ''}
      </p>
    </div>

    <div style="background-color: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        ${company.name ? `Sent by ${company.name}` : 'Sent via PITCH CRM'}
      </p>
    </div>
  </div>
  <img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />
</body></html>`;

    const fromEmail = company.email && company.email.includes('@')
      ? `${company.name || 'PITCH CRM'} <${company.email}>`
      : `PITCH CRM <orders@resend.dev>`;

    const emailResponse = await resend.emails.send({
      from: fromEmail,
      to: [crewEmail],
      subject: `Crew Work Order — ${customerName || 'New Job'}${projectAddress ? ` | ${projectAddress}` : ''}`,
      html,
    });

    const messageId = (emailResponse as any)?.data?.id ?? (emailResponse as any)?.id ?? null;
    if (messageId) {
      await serviceClient
        .from('labor_order_emails')
        .update({ resend_message_id: messageId })
        .eq('id', trackingId);
    }

    await serviceClient.from('communication_history').insert({
      type: 'email',
      direction: 'outbound',
      recipient: crewEmail,
      subject: `Crew Work Order - ${customerName || 'New Job'}`,
      body: html,
      status: 'sent',
      metadata: {
        estimateId,
        crewName,
        laborOrderEmail: true,
        trackingId,
        companyName: company.name,
      },
    });

    return new Response(
      JSON.stringify({ success: true, messageId, trackingId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('labor-order-send-email error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

Deno.serve(handler);
