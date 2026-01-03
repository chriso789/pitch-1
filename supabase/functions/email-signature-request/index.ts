import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  envelope_id: string;
  recipient_id: string;
  recipient_name: string;
  recipient_email: string;
  access_token: string;
  sender_name: string;
  sender_email?: string;
  subject: string;
  message: string;
  document_url?: string;
  is_reminder?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: RequestBody = await req.json();
    const {
      envelope_id,
      recipient_id,
      recipient_name,
      recipient_email,
      access_token,
      sender_name,
      sender_email,
      subject,
      message,
      is_reminder = false
    } = body;

    if (!recipient_email || !access_token) {
      return new Response(JSON.stringify({ error: "recipient_email and access_token required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant info for branding
    const { data: envelope } = await supabase
      .from("signature_envelopes")
      .select("*, tenant:tenant_id(name, settings)")
      .eq("id", envelope_id)
      .single();

    const tenantName = envelope?.tenant?.name || "PITCH CRM";
    const tenantSettings = envelope?.tenant?.settings || {};
    const primaryColor = tenantSettings.primary_color || "#2563eb";

    // Build signing URL - use the public signing page
    const appUrl = Deno.env.get("APP_URL") || "https://pitchcrm.app";
    const signingUrl = `${appUrl}/sign/${access_token}`;

    // Build professional email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #1e40af 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                ${is_reminder ? '⏰ Reminder: ' : ''}Document Signature Request
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Hi ${recipient_name},
              </p>
              
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                <strong>${sender_name}</strong> has sent you a document to review and sign.
              </p>
              
              ${message ? `
              <div style="background-color: #f9fafb; border-left: 4px solid ${primaryColor}; padding: 16px 20px; margin: 0 0 24px; border-radius: 0 4px 4px 0;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; font-style: italic;">
                  "${message}"
                </p>
              </div>
              ` : ''}
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${signingUrl}" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, #1e40af 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                      Review & Sign Document
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Security Note -->
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
                <p style="margin: 0; color: #92400e; font-size: 14px;">
                  🔒 <strong>Secure Signing:</strong> This link is unique to you and expires in 30 days. Your signature is legally binding.
                </p>
              </div>
              
              <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${signingUrl}" style="color: ${primaryColor}; word-break: break-all;">${signingUrl}</a>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                Sent via ${tenantName}<br>
                Powered by PITCH CRM Signature System
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    // Send email via Resend
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${tenantName} <signatures@pitchcrm.app>`,
        to: [recipient_email],
        subject: is_reminder ? `⏰ Reminder: ${subject}` : subject,
        html: emailHtml,
        reply_to: sender_email
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      throw new Error(resendData.message || "Failed to send email");
    }

    console.log(`Signature request email sent to ${recipient_email}, Resend ID: ${resendData.id}`);

    // Update recipient record with email sent timestamp
    await supabase
      .from("signature_recipients")
      .update({
        email_sent_at: new Date().toISOString(),
        last_reminder_at: is_reminder ? new Date().toISOString() : undefined
      })
      .eq("id", recipient_id);

    // Log email event
    await supabase
      .from("signature_events")
      .insert({
        envelope_id,
        tenant_id: envelope?.tenant_id,
        event_type: is_reminder ? "reminder_sent" : "invitation_sent",
        event_data: {
          recipient_id,
          recipient_email,
          resend_id: resendData.id
        }
      });

    return new Response(JSON.stringify({
      success: true,
      email_id: resendData.id,
      recipient_email
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in email-signature-request:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
