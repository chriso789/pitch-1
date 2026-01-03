/**
 * Send Security Alert Edge Function
 * Sends email notifications when suspicious login patterns are detected
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SecurityAlertPayload {
  tenant_id: string;
  alert_type: 'new_ip' | 'new_country' | 'vpn_detected' | 'multiple_failed_logins';
  user_id: string;
  user_name: string;
  user_email: string;
  ip_address?: string;
  location?: string;
  details?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: SecurityAlertPayload = await req.json();
    console.log('Received security alert:', payload);

    // Get tenant admin emails
    const { data: admins, error: adminsError } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('tenant_id', payload.tenant_id)
      .in('role', ['admin', 'owner']);

    if (adminsError) {
      console.error('Error fetching admins:', adminsError);
      throw adminsError;
    }

    if (!admins || admins.length === 0) {
      console.log('No admins found for tenant');
      return new Response(
        JSON.stringify({ success: true, message: 'No admins to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create in-app notifications for all admins
    const notifications = admins.map(admin => ({
      user_id: admin.id,
      tenant_id: payload.tenant_id,
      title: getAlertTitle(payload.alert_type),
      message: getAlertMessage(payload),
      type: 'security_alert',
      priority: payload.alert_type === 'new_country' ? 'high' : 'medium',
      is_read: false,
      metadata: {
        alert_type: payload.alert_type,
        affected_user_id: payload.user_id,
        ip_address: payload.ip_address,
        location: payload.location,
      },
    }));

    const { error: notifError } = await supabase
      .from('user_notifications')
      .insert(notifications);

    if (notifError) {
      console.error('Error creating notifications:', notifError);
    }

    // Send email if Resend is configured
    if (resendApiKey) {
      const adminEmails = admins.map(a => a.email).filter(Boolean);
      
      if (adminEmails.length > 0) {
        try {
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Security Alerts <security@pitchcrm.com>',
              to: adminEmails,
              subject: `🔒 Security Alert: ${getAlertTitle(payload.alert_type)}`,
              html: generateEmailHtml(payload),
            }),
          });

          if (!emailResponse.ok) {
            const error = await emailResponse.text();
            console.error('Error sending email:', error);
          } else {
            console.log('Security alert email sent to:', adminEmails);
          }
        } catch (emailErr) {
          console.error('Email sending failed:', emailErr);
        }
      }
    }

    // Log the security event
    await supabase.from('audit_log').insert({
      table_name: 'security_alerts',
      action: 'security_alert_triggered',
      record_id: payload.user_id,
      tenant_id: payload.tenant_id,
      new_values: payload,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        notified_admins: admins.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing security alert:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function getAlertTitle(type: string): string {
  switch (type) {
    case 'new_ip': return 'New IP Address Login';
    case 'new_country': return 'Login from New Country';
    case 'vpn_detected': return 'VPN/Proxy Login Detected';
    case 'multiple_failed_logins': return 'Multiple Failed Login Attempts';
    default: return 'Security Alert';
  }
}

function getAlertMessage(payload: SecurityAlertPayload): string {
  const userName = payload.user_name || 'A user';
  
  switch (payload.alert_type) {
    case 'new_ip':
      return `${userName} logged in from a new IP address: ${payload.ip_address}`;
    case 'new_country':
      return `${userName} logged in from a new country: ${payload.location}`;
    case 'vpn_detected':
      return `${userName} connected via VPN or proxy from ${payload.ip_address}`;
    case 'multiple_failed_logins':
      return `Multiple failed login attempts detected for ${userName}`;
    default:
      return payload.details || 'A security event was detected';
  }
}

function generateEmailHtml(payload: SecurityAlertPayload): string {
  const severityColor = payload.alert_type === 'new_country' ? '#dc2626' : 
                        payload.alert_type === 'multiple_failed_logins' ? '#dc2626' : '#f59e0b';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Security Alert</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
      <div style="background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; background: ${severityColor}20; color: ${severityColor}; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px;">
            🔒 Security Alert
          </div>
        </div>
        
        <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin-bottom: 16px; text-align: center;">
          ${getAlertTitle(payload.alert_type)}
        </h1>
        
        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <table style="width: 100%; font-size: 14px;">
            <tr>
              <td style="color: #6b7280; padding: 4px 0;">User:</td>
              <td style="color: #111827; font-weight: 500;">${payload.user_name} (${payload.user_email})</td>
            </tr>
            ${payload.ip_address ? `
            <tr>
              <td style="color: #6b7280; padding: 4px 0;">IP Address:</td>
              <td style="color: #111827; font-family: monospace;">${payload.ip_address}</td>
            </tr>
            ` : ''}
            ${payload.location ? `
            <tr>
              <td style="color: #6b7280; padding: 4px 0;">Location:</td>
              <td style="color: #111827;">${payload.location}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="color: #6b7280; padding: 4px 0;">Time:</td>
              <td style="color: #111827;">${new Date().toLocaleString()}</td>
            </tr>
          </table>
        </div>
        
        <p style="color: #6b7280; font-size: 14px; text-align: center;">
          If this was not you, please secure your account immediately.
        </p>
        
        <div style="text-align: center; margin-top: 24px;">
          <a href="https://app.pitchcrm.com/settings" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
            Review Activity
          </a>
        </div>
      </div>
      
      <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px;">
        This is an automated security notification from PITCH CRM.
      </p>
    </body>
    </html>
  `;
}
