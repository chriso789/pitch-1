import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendQuoteEmailRequest {
  estimate_id?: string;
  pipeline_entry_id?: string;  // Fallback to find estimate by lead
  contact_id: string;
  recipient_email: string;
  recipient_name: string;
  subject?: string;
  message?: string;
  pdf_url?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resend = new Resend(resendApiKey);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, tenants:tenant_id(name, logo_url, primary_color, secondary_color)")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ success: false, error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = profile.active_tenant_id || profile.tenant_id;
    const body: SendQuoteEmailRequest = await req.json();

    // Get estimate info - try by ID first, then by pipeline_entry_id
    let estimate: any = null;
    
    if (body.estimate_id) {
      const { data } = await supabase
        .from("enhanced_estimates")
        .select("id, estimate_number, selling_price, pipeline_entry_id, pipeline_entries(id, lead_number)")
        .eq("id", body.estimate_id)
        .eq("tenant_id", tenantId)
        .single();
      estimate = data;
    }
    
    // Fallback: find most recent estimate for this pipeline entry
    if (!estimate && body.pipeline_entry_id) {
      const { data } = await supabase
        .from("enhanced_estimates")
        .select("id, estimate_number, selling_price, pipeline_entry_id, pipeline_entries(id, lead_number)")
        .eq("pipeline_entry_id", body.pipeline_entry_id)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      estimate = data;
    }

    if (!estimate) {
      return new Response(
        JSON.stringify({ success: false, error: "Estimate not found. Please save the estimate first." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get company email domain settings
    const { data: emailDomain } = await supabase
      .from("company_email_domains")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("verification_status", "verified")
      .eq("is_active", true)
      .single();

    // Generate tracking token
    const trackingToken = crypto.randomUUID();
    const tokenHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(trackingToken)
    ).then(hash => 
      Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    );

    // Create tracking link
    const { data: trackingLink, error: trackingError } = await supabase
      .from("quote_tracking_links")
      .insert({
        tenant_id: tenantId,
        token: trackingToken,
        token_hash: tokenHash,
        estimate_id: estimate.id,  // Use resolved estimate ID
        contact_id: body.contact_id,
        pipeline_entry_id: estimate.pipeline_entry_id,
        pdf_url: body.pdf_url,
        recipient_email: body.recipient_email,
        recipient_name: body.recipient_name,
        sent_by: user.id,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
      })
      .select()
      .single();

    if (trackingError) {
      console.error("Error creating tracking link:", trackingError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create tracking link" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build tracking URL
    const viewQuoteUrl = `${supabaseUrl.replace('.supabase.co', '.lovable.app')}/view-quote/${trackingToken}`;

    // Email sender config - use verified domain
    const defaultFromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromEmail = emailDomain?.from_email || `quotes@${defaultFromDomain}`;
    const fromName = emailDomain?.from_name || profile.tenants?.name || "PITCH CRM";
    const replyTo = emailDomain?.reply_to_email || profile.email;
    const companyName = profile.tenants?.name || "Our Company";
    const primaryColor = profile.tenants?.primary_color || "#f97316";
    const logoUrl = profile.tenants?.logo_url;

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #1a1a2e 100%); padding: 32px; text-align: center;">
              ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 60px; margin-bottom: 16px;">` : ''}
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Your Quote is Ready!</h1>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 40px 32px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                Hi ${body.recipient_name.split(' ')[0]},
              </p>
              
              ${body.message ? `
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                ${body.message}
              </p>
              ` : `
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                Thank you for your interest! I've prepared a detailed quote for your project. Click the button below to view your personalized proposal.
              </p>
              `}
              
              <!-- Quote Summary Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; margin: 24px 0;">
                <tr>
                  <td style="padding: 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Quote Number</td>
                        <td style="text-align: right; color: #111827; font-weight: 600; font-size: 14px;">${estimate.estimate_number}</td>
                      </tr>
                      ${estimate.selling_price ? `
                      <tr>
                        <td style="color: #6b7280; font-size: 14px; padding-top: 12px;">Total Amount</td>
                        <td style="text-align: right; color: ${primaryColor}; font-weight: 700; font-size: 20px; padding-top: 12px;">$${Number(estimate.selling_price).toLocaleString()}</td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 16px 0 32px;">
                    <a href="${viewQuoteUrl}" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, #ea580c 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(249, 115, 22, 0.4);">
                      View Your Quote →
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
                This quote is valid for 30 days. If you have any questions, feel free to reply to this email or give us a call.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #1a1a2e; padding: 24px 32px; text-align: center;">
              <p style="color: #9ca3af; font-size: 14px; margin: 0 0 8px;">
                Sent by ${profile.first_name} ${profile.last_name} at ${companyName}
              </p>
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${profile.phone ? `📞 ${profile.phone} | ` : ''}📧 ${replyTo}
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
    const emailResult = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [body.recipient_email],
      reply_to: replyTo,
      subject: body.subject || `Your Quote from ${companyName} - #${estimate.estimate_number}`,
      html: emailHtml
    });

    console.log("Quote email sent:", emailResult);

    // Log to communication history
    await supabase
      .from("communication_history")
      .insert({
        tenant_id: tenantId,
        contact_id: body.contact_id,
        pipeline_entry_id: estimate.pipeline_entry_id,
        type: "email",
        direction: "outbound",
        subject: body.subject || `Your Quote from ${companyName}`,
        body: body.message || "Quote email sent",
        from_address: fromEmail,
        to_address: body.recipient_email,
        status: "sent",
        user_id: user.id,
        metadata: {
          tracking_link_id: trackingLink.id,
          estimate_id: body.estimate_id,
          resend_id: emailResult.data?.id
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Quote email sent successfully",
        tracking_link_id: trackingLink.id,
        view_url: viewQuoteUrl
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in send-quote-email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
