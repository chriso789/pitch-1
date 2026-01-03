import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get request body or use defaults
    const body = await req.json().catch(() => ({}));
    const daysUntilExpiry = body.days_until_expiry || 30;
    const sendNotifications = body.send_notifications !== false;

    console.log(`Checking warranties expiring within ${daysUntilExpiry} days`);

    // Find warranties expiring soon
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);

    const { data: expiringWarranties, error: queryError } = await supabase
      .from('warranties')
      .select(`
        *,
        contacts!inner(
          id,
          first_name,
          last_name,
          email,
          phone
        ),
        projects(
          id,
          address,
          project_name
        )
      `)
      .eq('status', 'active')
      .is('reminder_sent_at', null)
      .lte('end_date', expiryDate.toISOString().split('T')[0])
      .gte('end_date', new Date().toISOString().split('T')[0]);

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    console.log(`Found ${expiringWarranties?.length || 0} warranties expiring soon`);

    const results: any[] = [];

    if (expiringWarranties && expiringWarranties.length > 0 && sendNotifications) {
      for (const warranty of expiringWarranties) {
        const contact = warranty.contacts;
        const project = warranty.projects;
        
        // Get tenant info
        const { data: tenant } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', warranty.tenant_id)
          .single();

        const companyName = tenant?.name || 'Your Roofing Company';
        const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Valued Customer';
        
        const daysLeft = Math.ceil((new Date(warranty.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

        const result: any = {
          warranty_id: warranty.id,
          contact_id: contact.id,
          days_until_expiry: daysLeft
        };

        // Send email notification if email available
        if (contact.email && resendKey) {
          try {
            const emailHtml = `
              <!DOCTYPE html>
              <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                  .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                  .warning-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
                  .button { display: inline-block; background: #2563eb; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; }
                  .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                  .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>⚠️ Warranty Expiration Notice</h1>
                  </div>
                  <div class="content">
                    <h2>Hi ${contactName},</h2>
                    
                    <div class="warning-box">
                      <strong>Your warranty is expiring in ${daysLeft} days!</strong>
                    </div>
                    
                    <div class="details">
                      <h3>Warranty Details</h3>
                      <p><strong>Type:</strong> ${warranty.warranty_type}</p>
                      <p><strong>Manufacturer:</strong> ${warranty.manufacturer_name || 'N/A'}</p>
                      <p><strong>Product:</strong> ${warranty.product_name || 'N/A'}</p>
                      <p><strong>Coverage:</strong> ${warranty.coverage_description || 'Standard coverage'}</p>
                      <p><strong>Expiration Date:</strong> ${new Date(warranty.end_date).toLocaleDateString()}</p>
                      ${project ? `<p><strong>Property:</strong> ${project.address || project.project_name}</p>` : ''}
                    </div>
                    
                    <h3>What Should You Do?</h3>
                    <ul>
                      <li>Schedule a free inspection before your warranty expires</li>
                      <li>Document any existing issues that may be covered</li>
                      <li>Consider extending your warranty coverage</li>
                    </ul>
                    
                    <p style="text-align: center; margin-top: 30px;">
                      <a href="mailto:${tenant?.settings?.contact_email || 'info@company.com'}?subject=Warranty Inspection Request" class="button">
                        Schedule Inspection
                      </a>
                    </p>
                    
                    <p>Don't let your warranty expire without making sure everything is in order. Our team is here to help!</p>
                    
                    <p>Best regards,<br>The ${companyName} Team</p>
                  </div>
                  <div class="footer">
                    <p>This is an automated warranty reminder from ${companyName}</p>
                  </div>
                </div>
              </body>
              </html>
            `;

            const emailResponse = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: `${companyName} <warranty@${tenant?.domain || 'notifications.resend.dev'}>`,
                to: [contact.email],
                subject: `⚠️ Your Warranty Expires in ${daysLeft} Days - Action Required`,
                html: emailHtml
              })
            });

            const emailResult = await emailResponse.json();
            result.email_sent = true;
            result.email_id = emailResult.id;
          } catch (emailError) {
            console.error('Email error:', emailError);
            result.email_sent = false;
            result.email_error = emailError.message;
          }
        }

        // Send SMS notification if phone available
        if (contact.phone) {
          try {
            const smsMessage = `Hi ${contactName}! Your ${warranty.warranty_type} warranty from ${companyName} expires in ${daysLeft} days. Schedule a free inspection before it expires! Call us or reply to this message.`;

            await supabase.functions.invoke('telnyx-send-sms', {
              body: {
                tenant_id: warranty.tenant_id,
                to: contact.phone,
                message: smsMessage,
                contact_id: contact.id
              }
            });
            result.sms_sent = true;
          } catch (smsError) {
            console.error('SMS error:', smsError);
            result.sms_sent = false;
            result.sms_error = smsError.message;
          }
        }

        // Update warranty with reminder sent timestamp
        await supabase
          .from('warranties')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', warranty.id);

        results.push(result);
      }
    }

    // Create service opportunities for expiring warranties
    for (const warranty of expiringWarranties || []) {
      // Check if opportunity already exists
      const { data: existingOpp } = await supabase
        .from('ai_insights')
        .select('id')
        .eq('context_type', 'warranty_expiry')
        .eq('context_id', warranty.id)
        .single();

      if (!existingOpp) {
        await supabase
          .from('ai_insights')
          .insert({
            tenant_id: warranty.tenant_id,
            context_type: 'warranty_expiry',
            context_id: warranty.id,
            insight_type: 'service_opportunity',
            title: 'Warranty Expiring Soon',
            description: `${warranty.warranty_type} warranty expiring on ${new Date(warranty.end_date).toLocaleDateString()}. Great opportunity for maintenance inspection or warranty extension.`,
            priority: 'high',
            status: 'active',
            metadata: {
              warranty_id: warranty.id,
              contact_id: warranty.contact_id,
              project_id: warranty.project_id,
              expiry_date: warranty.end_date,
              warranty_type: warranty.warranty_type
            }
          });
      }
    }

    console.log(`Processed ${results.length} warranty notifications`);

    return new Response(JSON.stringify({
      success: true,
      warranties_checked: expiringWarranties?.length || 0,
      notifications_sent: results.length,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Warranty notification error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
