import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

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

    const { orderId, action, vendors, subject, message } = await req.json();
    console.log('Processing material order email:', { orderId, action });

    // Handle bulk vendor notification
    if (action === 'bulk_vendor_notification') {
      if (!vendors || !Array.isArray(vendors)) {
        throw new Error('Vendors array is required for bulk notifications');
      }

      const results = [];
      for (const vendor of vendors) {
        try {
          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #667eea;">Hello ${vendor.name},</h2>
              <div style="margin: 20px 0;">
                ${message.split('\n').map((line: string) => `<p style="margin: 10px 0;">${line}</p>`).join('')}
              </div>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 12px;">This is an automated message from PITCH CRM. Please do not reply to this email.</p>
            </body>
            </html>
          `;

          const emailResponse = await resend.emails.send({
            from: 'PITCH CRM <orders@pitch.app>',
            to: [vendor.email],
            subject: subject,
            html: emailHtml,
          });

          results.push({ vendor: vendor.name, success: true, messageId: emailResponse.id });
          
          // Log communication
          const serviceClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
          );

          await serviceClient
            .from('communication_history')
            .insert({
              type: 'email',
              direction: 'outbound',
              recipient: vendor.email,
              subject: subject,
              body: emailHtml,
              status: 'sent',
              metadata: {
                vendorId: vendor.id,
                bulkNotification: true
              }
            });
        } catch (error: any) {
          console.error(`Error sending to ${vendor.name}:`, error);
          results.push({ vendor: vendor.name, success: false, error: error.message });
        }
      }

      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch order details with vendor and items
    const { data: order, error: orderError } = await supabaseClient
      .from('material_orders')
      .select(`
        *,
        vendors:vendor_id (
          name,
          email,
          contact_name,
          phone
        ),
        material_order_items (
          item_description,
          quantity,
          unit_price,
          total_price
        ),
        estimates:estimate_id (
          project_id,
          projects:project_id (
            name,
            clj_formatted_number
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order fetch error:', orderError);
      throw new Error('Order not found');
    }

    const vendor = order.vendors;
    if (!vendor || !vendor.email) {
      throw new Error('Vendor email not found');
    }

    // Generate email content based on action
    let subject = '';
    let html = '';
    const projectName = order.estimates?.projects?.name || 'Project';
    const projectNumber = order.estimates?.projects?.clj_formatted_number || '';

    if (action === 'submit') {
      subject = `Purchase Order ${order.po_number} - ${projectName}`;
      html = generateSubmitEmailHTML(order, vendor, projectName, projectNumber);
    } else if (action === 'status_change') {
      subject = `PO ${order.po_number} Status Update - ${order.status}`;
      html = generateStatusChangeEmailHTML(order, vendor, projectName, projectNumber);
    } else if (action === 'reminder') {
      subject = `Reminder: PO ${order.po_number} - Delivery Pending`;
      html = generateReminderEmailHTML(order, vendor, projectName, projectNumber);
    }

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: 'PITCH CRM <orders@pitch.app>',
      to: [vendor.email],
      subject: subject,
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
        recipient: vendor.email,
        subject: subject,
        body: html,
        status: 'sent',
        metadata: {
          orderId: orderId,
          poNumber: order.po_number,
          action: action
        }
      });

    return new Response(
      JSON.stringify({ success: true, messageId: emailResponse.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in material-order-send-email:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function generateSubmitEmailHTML(order: any, vendor: any, projectName: string, projectNumber: string): string {
  const items = order.material_order_items || [];
  const itemsHTML = items.map((item: any) => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px; text-align: left;">${item.item_description}</td>
      <td style="padding: 12px; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px; text-align: right;">$${item.unit_price?.toFixed(2) || '0.00'}</td>
      <td style="padding: 12px; text-align: right; font-weight: bold;">$${item.total_price?.toFixed(2) || '0.00'}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Purchase Order</h1>
          <p style="color: #e0e7ff; margin: 8px 0 0 0; font-size: 16px;">PO# ${order.po_number}</p>
        </div>
        
        <div style="padding: 32px;">
          <p style="margin: 0 0 16px 0; font-size: 16px;">Dear ${vendor.contact_name || vendor.name},</p>
          
          <p style="margin: 0 0 24px 0; font-size: 15px;">
            Please find below our purchase order for materials needed for <strong>${projectName}</strong> ${projectNumber ? `(${projectNumber})` : ''}.
          </p>

          <div style="background-color: #f3f4f6; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
            <table style="width: 100%; font-size: 14px;">
              <tr>
                <td style="padding: 4px 0;"><strong>Branch Code:</strong></td>
                <td style="padding: 4px 0; text-align: right;">${order.branch_code || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0;"><strong>Required Date:</strong></td>
                <td style="padding: 4px 0; text-align: right;">${order.required_date ? new Date(order.required_date).toLocaleDateString() : 'ASAP'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0;"><strong>Delivery Address:</strong></td>
                <td style="padding: 4px 0; text-align: right;">${order.delivery_address || 'Job Site'}</td>
              </tr>
            </table>
          </div>

          <h3 style="margin: 24px 0 12px 0; font-size: 18px; color: #374151;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                <th style="padding: 12px; text-align: left; font-weight: 600;">Description</th>
                <th style="padding: 12px; text-align: center; font-weight: 600;">Qty</th>
                <th style="padding: 12px; text-align: right; font-weight: 600;">Unit Price</th>
                <th style="padding: 12px; text-align: right; font-weight: 600;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
            <tfoot>
              <tr style="background-color: #f9fafb; font-weight: bold;">
                <td colspan="3" style="padding: 12px; text-align: right;">Total Amount:</td>
                <td style="padding: 12px; text-align: right; color: #667eea; font-size: 16px;">$${order.total_amount?.toFixed(2) || '0.00'}</td>
              </tr>
            </tfoot>
          </table>

          ${order.notes ? `
            <div style="margin-top: 24px; padding: 16px; background-color: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
              <p style="margin: 0; font-size: 14px; color: #92400e;"><strong>Notes:</strong> ${order.notes}</p>
            </div>
          ` : ''}

          <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
            Please confirm receipt of this order and provide an estimated delivery date.
          </p>
          
          <p style="margin: 16px 0 0 0; font-size: 14px;">
            Best regards,<br>
            <strong>PITCH CRM Materials Team</strong>
          </p>
        </div>

        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #6b7280;">
            This is an automated message from PITCH CRM. Please do not reply to this email.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateStatusChangeEmailHTML(order: any, vendor: any, projectName: string, projectNumber: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #667eea;">Purchase Order Status Update</h2>
      <p>Dear ${vendor.contact_name || vendor.name},</p>
      <p>The status of purchase order <strong>${order.po_number}</strong> for ${projectName} has been updated to: <strong style="color: #667eea; text-transform: uppercase;">${order.status}</strong></p>
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Total Amount:</strong> $${order.total_amount?.toFixed(2) || '0.00'}</p>
        <p style="margin: 10px 0 0 0;"><strong>Required Date:</strong> ${order.required_date ? new Date(order.required_date).toLocaleDateString() : 'ASAP'}</p>
      </div>
      <p>Thank you for your continued partnership.</p>
      <p>Best regards,<br><strong>PITCH CRM Team</strong></p>
    </body>
    </html>
  `;
}

function generateReminderEmailHTML(order: any, vendor: any, projectName: string, projectNumber: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f59e0b;">Delivery Reminder</h2>
      <p>Dear ${vendor.contact_name || vendor.name},</p>
      <p>This is a friendly reminder regarding purchase order <strong>${order.po_number}</strong> for ${projectName}.</p>
      <div style="background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
        <p style="margin: 0;"><strong>Status:</strong> ${order.status}</p>
        <p style="margin: 10px 0 0 0;"><strong>Required Date:</strong> ${order.required_date ? new Date(order.required_date).toLocaleDateString() : 'ASAP'}</p>
        <p style="margin: 10px 0 0 0;"><strong>Total Amount:</strong> $${order.total_amount?.toFixed(2) || '0.00'}</p>
      </div>
      <p>Please provide an update on the delivery status at your earliest convenience.</p>
      <p>Thank you,<br><strong>PITCH CRM Materials Team</strong></p>
    </body>
    </html>
  `;
}
