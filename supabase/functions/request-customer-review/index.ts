import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReviewRequest {
  tenant_id: string;
  project_id?: string;
  contact_id: string;
  review_type: 'google' | 'yelp' | 'facebook' | 'bbb' | 'internal';
  send_via: 'sms' | 'email' | 'both';
  custom_message?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseKey);
    const request: ReviewRequest = await req.json();
    const { tenant_id, project_id, contact_id, review_type, send_via, custom_message } = request;

    console.log(`Review request for contact ${contact_id}, type: ${review_type}`);

    // Get contact details
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contact_id)
      .single();

    if (contactError || !contact) {
      throw new Error(`Contact not found: ${contactError?.message}`);
    }

    // Get tenant/company details
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenant_id)
      .single();

    if (tenantError || !tenant) {
      throw new Error(`Tenant not found: ${tenantError?.message}`);
    }

    // Get project if provided
    let project = null;
    if (project_id) {
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', project_id)
        .single();
      project = projectData;
    }

    // Generate unique tracking token
    const trackingToken = crypto.randomUUID();

    // Get review link based on type
    let reviewUrl = '';
    const companySettings = tenant.settings as any || {};
    
    switch (review_type) {
      case 'google':
        reviewUrl = companySettings.google_review_url || `https://search.google.com/local/writereview?placeid=${companySettings.google_place_id || ''}`;
        break;
      case 'yelp':
        reviewUrl = companySettings.yelp_url || 'https://yelp.com';
        break;
      case 'facebook':
        reviewUrl = companySettings.facebook_url || 'https://facebook.com';
        break;
      case 'bbb':
        reviewUrl = companySettings.bbb_url || 'https://bbb.org';
        break;
      case 'internal':
        reviewUrl = `${supabaseUrl.replace('.supabase.co', '')}/review/${trackingToken}`;
        break;
    }

    // Create review request record
    const { data: reviewRecord, error: recordError } = await supabase
      .from('customer_reviews')
      .insert({
        tenant_id,
        contact_id,
        project_id,
        platform: review_type,
        status: 'pending',
        review_link: reviewUrl,
        tracking_token: trackingToken,
        metadata: {
          send_via,
          custom_message,
          sent_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (recordError) {
      console.error('Error creating review record:', recordError);
    }

    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Valued Customer';
    const companyName = tenant.name || 'Our Company';

    // Default message template
    const defaultMessage = custom_message || 
      `Hi ${contactName}! Thank you for choosing ${companyName}. We'd love to hear about your experience! Would you mind leaving us a quick review? It really helps our business. ${reviewUrl}`;

    const results: { sms?: any; email?: any } = {};

    // Send SMS if requested
    if (send_via === 'sms' || send_via === 'both') {
      if (contact.phone) {
        try {
          const smsResponse = await supabase.functions.invoke('telnyx-send-sms', {
            body: {
              tenant_id,
              to: contact.phone,
              message: defaultMessage,
              contact_id
            }
          });
          results.sms = { success: true, ...smsResponse.data };
        } catch (smsError) {
          console.error('SMS send error:', smsError);
          results.sms = { success: false, error: smsError.message };
        }
      } else {
        results.sms = { success: false, error: 'No phone number available' };
      }
    }

    // Send email if requested
    if ((send_via === 'email' || send_via === 'both') && resendKey) {
      if (contact.email) {
        try {
          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { text-align: center; margin-bottom: 30px; }
                .logo { max-width: 200px; height: auto; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 10px; }
                .button { display: inline-block; background: #2563eb; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
                .stars { font-size: 40px; color: #fbbf24; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>${companyName}</h1>
                </div>
                <div class="content">
                  <h2>Hi ${contactName}! 👋</h2>
                  <p>Thank you for choosing ${companyName} for your recent project${project ? ` at ${project.address || ''}` : ''}!</p>
                  <p>We hope everything went smoothly and you're happy with the results. Your feedback means the world to us and helps other homeowners find quality service.</p>
                  <div class="stars">⭐⭐⭐⭐⭐</div>
                  <p><strong>Would you take a moment to share your experience?</strong></p>
                  <p style="text-align: center;">
                    <a href="${reviewUrl}" class="button">Leave a Review</a>
                  </p>
                  <p>It only takes a minute, and we'd be incredibly grateful!</p>
                  <p>Thanks again for trusting us with your home.</p>
                  <p>Warm regards,<br>The ${companyName} Team</p>
                </div>
                <div class="footer">
                  <p>Questions? Reply to this email or call us anytime.</p>
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
              from: `${companyName} <reviews@${tenant.domain || 'notifications.resend.dev'}>`,
              to: [contact.email],
              subject: `How was your experience with ${companyName}? ⭐`,
              html: emailHtml,
              tags: [
                { name: 'type', value: 'review-request' },
                { name: 'tenant', value: tenant_id },
                { name: 'contact', value: contact_id }
              ]
            })
          });

          const emailResult = await emailResponse.json();
          results.email = { success: true, ...emailResult };
        } catch (emailError) {
          console.error('Email send error:', emailError);
          results.email = { success: false, error: emailError.message };
        }
      } else {
        results.email = { success: false, error: 'No email address available' };
      }
    }

    // Update review record with send status
    if (reviewRecord) {
      await supabase
        .from('customer_reviews')
        .update({
          metadata: {
            ...(reviewRecord.metadata as any || {}),
            send_results: results
          }
        })
        .eq('id', reviewRecord.id);
    }

    console.log(`Review request sent successfully for ${contact_id}`);

    return new Response(JSON.stringify({
      success: true,
      review_id: reviewRecord?.id,
      review_url: reviewUrl,
      tracking_token: trackingToken,
      send_results: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Review request error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
