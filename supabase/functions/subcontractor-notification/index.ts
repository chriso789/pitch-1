import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  tenant_id: string;
  subcontractor_id: string;
  assignment_id?: string;
  notification_type: 'job_assignment' | 'schedule_reminder' | 'payment_notification' | 'document_request';
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
    const request: NotificationRequest = await req.json();
    const { tenant_id, subcontractor_id, assignment_id, notification_type, custom_message } = request;

    console.log(`Subcontractor notification: ${notification_type} for ${subcontractor_id}`);

    // Get subcontractor details
    const { data: subcontractor, error: subError } = await supabase
      .from('subcontractor_profiles')
      .select('*')
      .eq('id', subcontractor_id)
      .single();

    if (subError || !subcontractor) {
      throw new Error(`Subcontractor not found: ${subError?.message}`);
    }

    // Get tenant info
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenant_id)
      .single();

    const companyName = tenant?.name || 'PITCH CRM';

    // Get assignment details if provided
    let assignment = null;
    let project = null;
    if (assignment_id) {
      const { data: assignmentData } = await supabase
        .from('subcontractor_assignments')
        .select(`
          *,
          projects(
            id,
            address,
            project_name,
            contacts(first_name, last_name, phone)
          )
        `)
        .eq('id', assignment_id)
        .single();
      assignment = assignmentData;
      project = assignmentData?.projects;
    }

    let subject = '';
    let emailContent = '';
    let smsMessage = '';

    switch (notification_type) {
      case 'job_assignment':
        subject = `New Job Assignment from ${companyName}`;
        emailContent = `
          <h2>New Job Assignment</h2>
          <p>Hi ${subcontractor.contact_name},</p>
          <p>You have been assigned a new job:</p>
          <div class="details">
            <p><strong>Job Type:</strong> ${assignment?.assignment_type || 'Roofing Work'}</p>
            <p><strong>Location:</strong> ${project?.address || 'TBD'}</p>
            <p><strong>Scheduled Date:</strong> ${assignment?.scheduled_date ? new Date(assignment.scheduled_date).toLocaleDateString() : 'TBD'}</p>
            <p><strong>Estimated Hours:</strong> ${assignment?.estimated_hours || 'TBD'}</p>
            <p><strong>Rate:</strong> $${assignment?.agreed_rate || subcontractor.hourly_rate || 'Per agreement'} / ${assignment?.rate_type || 'hour'}</p>
          </div>
          <p>Please confirm your availability by responding to this email or logging into the portal.</p>
        `;
        smsMessage = `New job from ${companyName}! ${assignment?.assignment_type || 'Work'} at ${project?.address || 'location TBD'} on ${assignment?.scheduled_date ? new Date(assignment.scheduled_date).toLocaleDateString() : 'date TBD'}. Reply YES to confirm or call us.`;
        break;

      case 'schedule_reminder':
        subject = `Reminder: Job Tomorrow - ${companyName}`;
        emailContent = `
          <h2>Schedule Reminder</h2>
          <p>Hi ${subcontractor.contact_name},</p>
          <p>This is a reminder that you have a job scheduled tomorrow:</p>
          <div class="details">
            <p><strong>Job Type:</strong> ${assignment?.assignment_type || 'Roofing Work'}</p>
            <p><strong>Location:</strong> ${project?.address || 'See details in portal'}</p>
            <p><strong>Start Time:</strong> ${assignment?.scheduled_start_time || '8:00 AM'}</p>
            <p><strong>Contact:</strong> ${project?.contacts ? `${project.contacts.first_name} ${project.contacts.last_name} - ${project.contacts.phone}` : 'See portal'}</p>
          </div>
          <p>Please arrive on time with all necessary equipment and materials.</p>
        `;
        smsMessage = `Reminder: Job tomorrow at ${project?.address || 'scheduled location'}. Start time: ${assignment?.scheduled_start_time || '8:00 AM'}. - ${companyName}`;
        break;

      case 'payment_notification':
        subject = `Payment Processed - ${companyName}`;
        emailContent = `
          <h2>Payment Notification</h2>
          <p>Hi ${subcontractor.contact_name},</p>
          <p>Your payment has been processed:</p>
          <div class="details">
            <p><strong>Amount:</strong> $${assignment?.total_amount || 'See invoice'}</p>
            <p><strong>Payment Method:</strong> Direct Deposit</p>
            <p><strong>Reference:</strong> ${assignment_id || 'See portal'}</p>
          </div>
          <p>Thank you for your excellent work!</p>
        `;
        smsMessage = `Payment of $${assignment?.total_amount || ''} has been processed. Thank you! - ${companyName}`;
        break;

      case 'document_request':
        subject = `Document Update Required - ${companyName}`;
        emailContent = `
          <h2>Document Update Required</h2>
          <p>Hi ${subcontractor.contact_name},</p>
          <p>We need you to update some documents in your profile:</p>
          <ul>
            ${subcontractor.insurance_expiry && new Date(subcontractor.insurance_expiry) < new Date() ? '<li>Insurance Certificate (expired)</li>' : ''}
            ${subcontractor.license_expiry && new Date(subcontractor.license_expiry) < new Date() ? '<li>License (expired)</li>' : ''}
            ${subcontractor.workers_comp_expiry && new Date(subcontractor.workers_comp_expiry) < new Date() ? '<li>Workers Comp Certificate (expired)</li>' : ''}
          </ul>
          <p>Please upload updated documents to continue receiving job assignments.</p>
        `;
        smsMessage = `${companyName}: Your documents need updating. Please log in to the subcontractor portal to upload current certificates.`;
        break;

      default:
        emailContent = custom_message || 'Please check the subcontractor portal for updates.';
        smsMessage = custom_message || `Update from ${companyName}. Please check your portal.`;
    }

    const results: { email?: any; sms?: any } = {};

    // Send email
    if (subcontractor.email && resendKey) {
      try {
        const fullEmailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2563eb; }
              .button { display: inline-block; background: #2563eb; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; }
              .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${companyName}</h1>
                <p>Subcontractor Portal</p>
              </div>
              <div class="content">
                ${emailContent}
                <p style="text-align: center; margin-top: 30px;">
                  <a href="${supabaseUrl.replace('.supabase.co', '')}/subcontractor-portal" class="button">
                    Open Portal
                  </a>
                </p>
              </div>
              <div class="footer">
                <p>This notification was sent from ${companyName}'s Subcontractor Management System</p>
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
            from: `${companyName} <subcontractors@${tenant?.domain || 'notifications.resend.dev'}>`,
            to: [subcontractor.email],
            subject,
            html: fullEmailHtml
          })
        });

        const emailResult = await emailResponse.json();
        results.email = { success: true, id: emailResult.id };
      } catch (emailError) {
        console.error('Email error:', emailError);
        results.email = { success: false, error: emailError.message };
      }
    }

    // Send SMS
    if (subcontractor.phone) {
      try {
        await supabase.functions.invoke('telnyx-send-sms', {
          body: {
            tenant_id,
            to: subcontractor.phone,
            message: smsMessage
          }
        });
        results.sms = { success: true };
      } catch (smsError) {
        console.error('SMS error:', smsError);
        results.sms = { success: false, error: smsError.message };
      }
    }

    // Log notification
    await supabase
      .from('notifications')
      .insert({
        tenant_id,
        recipient_type: 'subcontractor',
        recipient_id: subcontractor_id,
        notification_type,
        title: subject,
        message: smsMessage,
        metadata: {
          assignment_id,
          results
        },
        status: 'sent'
      });

    console.log(`Notification sent to subcontractor ${subcontractor_id}`);

    return new Response(JSON.stringify({
      success: true,
      notification_type,
      subcontractor_id,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Subcontractor notification error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
