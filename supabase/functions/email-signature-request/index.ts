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
  cc?: string[];
  bcc?: string[];
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
      is_reminder = false,
      cc,
      bcc
    } = body;

    if (!recipient_email || !access_token) {
      return new Response(JSON.stringify({ error: "recipient_email and access_token required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant info for branding (include logo, phone, email)
    const { data: envelope } = await supabase
      .from("signature_envelopes")
      .select("*, tenant:tenant_id(name, settings, logo_url, phone, email)")
      .eq("id", envelope_id)
      .single();

    let tenantName = envelope?.tenant?.name || "PITCH CRM";
    let tenantSettings = envelope?.tenant?.settings || {};
    let tenantLogoUrl = envelope?.tenant?.logo_url || null;
    let tenantPhone = envelope?.tenant?.phone || null;
    let tenantEmail = envelope?.tenant?.email || null;
    const tenantId = envelope?.tenant_id;

    // Fallback: if join didn't resolve tenant, query directly
    if (tenantName === "PITCH CRM" && tenantId) {
      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("name, settings, logo_url, phone, email")
        .eq("id", tenantId)
        .single();
      if (tenantRow) {
        tenantName = tenantRow.name;
        tenantSettings = tenantRow.settings || {};
        tenantLogoUrl = tenantRow.logo_url || tenantLogoUrl;
        tenantPhone = tenantRow.phone || tenantPhone;
        tenantEmail = tenantRow.email || tenantEmail;
      }
    }

    const primaryColor = tenantSettings.primary_color || "#2563eb";

    // Look up company email domain for sending from company domain
    let fromEmail: string;
    let fromName: string;
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";

    if (tenantId) {
      const { data: emailDomain } = await supabase
        .from("company_email_domains")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("verification_status", "verified")
        .eq("is_active", true)
        .maybeSingle();

      fromEmail = emailDomain?.from_email || `signatures@${fromDomain}`;
      fromName = emailDomain?.from_name || tenantName;
    } else {
      fromEmail = `signatures@${fromDomain}`;
      fromName = tenantName;
    }

    // Build signing URL
    const appUrl = Deno.env.get("APP_URL") || "https://pitchcrm.app";
    const signingUrl = `${appUrl}/sign/${access_token}`;

    // Company logo HTML (if available)
    const logoHtml = tenantLogoUrl
      ? `<img src="${tenantLogoUrl}" alt="${tenantName}" style="max-height: 48px; max-width: 200px; margin-bottom: 12px;" /><br>`
      : '';

    // Build footer contact details
    const footerParts: string[] = [];
    if (tenantPhone) footerParts.push(tenantPhone);
    if (tenantEmail) footerParts.push(tenantEmail);
    const footerContactLine = footerParts.length > 0
      ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 12px;">${footerParts.join(' &nbsp;•&nbsp; ')}</p>`
      : '';

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
          <!-- Header with logo & company name -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #1e40af 100%); padding: 32px 40px; text-align: center;">
              ${logoHtml}
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 600;">
                ${tenantName}
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
                ${is_reminder
                  ? `This is a friendly reminder — <strong>${sender_name}</strong> at <strong>${tenantName}</strong> has a proposal waiting for your review.`
                  : `<strong>${sender_name}</strong> at <strong>${tenantName}</strong> has prepared a proposal for your review.`
                }
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
                      Review Your Proposal
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Soft security note -->
              <p style="margin: 24px 0 0; color: #9ca3af; font-size: 13px; text-align: center; line-height: 1.5;">
                🔒 This secure link was created just for you and is valid for 30 days.
              </p>
              
              <p style="margin: 16px 0 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${signingUrl}" style="color: ${primaryColor}; word-break: break-all; font-size: 12px;">${signingUrl}</a>
              </p>
            </td>
          </tr>
          
          <!-- Footer with company info -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; color: #374151; font-size: 13px; font-weight: 600;">
                ${tenantName}
              </p>
              ${footerContactLine}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    // Send email via Resend - from company domain
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [recipient_email],
        subject: is_reminder ? `Reminder: ${subject}` : subject,
        html: emailHtml,
        reply_to: sender_email,
        ...(cc && cc.length > 0 && { cc }),
        ...(bcc && bcc.length > 0 && { bcc }),
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      throw new Error(resendData.message || "Failed to send email");
    }

    console.log(`Signature request email sent to ${recipient_email} from ${fromName} <${fromEmail}>, Resend ID: ${resendData.id}`);

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
        event_metadata: {
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
