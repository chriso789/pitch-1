import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OnboardingEmailRequest {
  tenant_id: string;
  user_id?: string;
  email: string;
  first_name: string;
  last_name?: string;
  company_name: string;
}

const generatePremiumEmailHtml = (firstName: string, companyName: string, onboardingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Welcome to PITCH CRM</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <!-- Main Container -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <!-- Email Card -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <!-- Premium Header with Gold Accent -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); border-radius: 24px 24px 0 0; padding: 0; position: relative; overflow: hidden;">
              <!-- Gold Top Line -->
              <div style="height: 4px; background: linear-gradient(90deg, #d4af37 0%, #f4e4bc 50%, #d4af37 100%);"></div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 48px 40px 32px;">
                    <!-- Logo Area -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 20px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px; box-shadow: 0 8px 32px rgba(22, 163, 74, 0.3);">
                            <span style="font-size: 40px; font-weight: 800; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">P</span>
                          </div>
                          <h1 style="margin: 0; font-size: 32px; font-weight: 800; letter-spacing: -0.5px;">
                            <span style="color: #ffffff;">PITCH</span>
                            <span style="color: #d4af37;"> CRM</span>
                          </h1>
                          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px; letter-spacing: 2px; text-transform: uppercase;">
                            The #1 Construction Sales Platform
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="background: #ffffff; padding: 48px 40px;">
              
              <!-- Personalized Greeting -->
              <h2 style="margin: 0 0 16px; font-size: 28px; font-weight: 700; color: #0f172a;">
                Welcome aboard, ${firstName}! 🎉
              </h2>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.7; color: #475569;">
                Your account for <strong style="color: #16a34a;">${companyName}</strong> is ready. You're about to transform how your team sells, manages projects, and closes deals.
              </p>
              
              <!-- Progress Indicator -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 24px; border: 1px solid #bbf7d0;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #16a34a; text-transform: uppercase; letter-spacing: 1px;">
                            Your Setup Progress
                          </p>
                          <table role="presentation" cellspacing="0" cellpadding="0">
                            <tr>
                              <td style="width: 32px; height: 32px; background: #16a34a; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: white; font-weight: 700; font-size: 14px;">1</span>
                              </td>
                              <td style="width: 60px; height: 4px; background: #e2e8f0;"></td>
                              <td style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: #94a3b8; font-weight: 700; font-size: 14px;">2</span>
                              </td>
                              <td style="width: 60px; height: 4px; background: #e2e8f0;"></td>
                              <td style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: #94a3b8; font-weight: 700; font-size: 14px;">3</span>
                              </td>
                              <td style="width: 60px; height: 4px; background: #e2e8f0;"></td>
                              <td style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: #94a3b8; font-weight: 700; font-size: 14px;">4</span>
                              </td>
                              <td style="width: 60px; height: 4px; background: #e2e8f0;"></td>
                              <td style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: #94a3b8; font-weight: 700; font-size: 14px;">5</span>
                              </td>
                            </tr>
                          </table>
                          <p style="margin: 12px 0 0; color: #475569; font-size: 14px;">
                            <strong>Step 1 of 5:</strong> Account Activation
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Primary CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td align="center">
                    <a href="${onboardingUrl}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; text-decoration: none; padding: 18px 48px; border-radius: 12px; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 8px 24px rgba(22, 163, 74, 0.35), inset 0 1px 0 rgba(255,255,255,0.2);">
                      Complete Your Setup →
                    </a>
                    <p style="margin: 12px 0 0; color: #94a3b8; font-size: 13px;">
                      ⏱️ Takes only 10 minutes
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Value Proposition Grid -->
              <h3 style="margin: 0 0 20px; font-size: 18px; font-weight: 700; color: #0f172a;">
                What You're Getting:
              </h3>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #16a34a;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #16a34a20 0%, #16a34a10 100%); border-radius: 10px; text-align: center; line-height: 40px; font-size: 20px;">📞</div>
                        </td>
                        <td valign="top">
                          <p style="margin: 0; font-weight: 600; color: #0f172a;">Power Dialer</p>
                          <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$149/mo value — Triple-line calling, 300 calls/hour</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height: 12px;"></td></tr>
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #d4af37;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #d4af3720 0%, #d4af3710 100%); border-radius: 10px; text-align: center; line-height: 40px; font-size: 20px;">📐</div>
                        </td>
                        <td valign="top">
                          <p style="margin: 0; font-weight: 600; color: #0f172a;">AI Roof Measurements</p>
                          <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$50/report saved — 98% accurate satellite measurements</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height: 12px;"></td></tr>
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #3b82f6;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #3b82f620 0%, #3b82f610 100%); border-radius: 10px; text-align: center; line-height: 40px; font-size: 20px;">📋</div>
                        </td>
                        <td valign="top">
                          <p style="margin: 0; font-weight: 600; color: #0f172a;">Smart Estimates & Contracts</p>
                          <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$99/mo value — Auto-populated, e-signature ready</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height: 12px;"></td></tr>
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #8b5cf6;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50" valign="top">
                          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #8b5cf620 0%, #8b5cf610 100%); border-radius: 10px; text-align: center; line-height: 40px; font-size: 20px;">🗺️</div>
                        </td>
                        <td valign="top">
                          <p style="margin: 0; font-weight: 600; color: #0f172a;">Territory Mapping</p>
                          <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$125/mo value — GPS tracking, route optimization</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Testimonial -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; padding: 28px; position: relative;">
                    <div style="position: absolute; top: 20px; left: 28px; font-size: 48px; color: #d4af37; opacity: 0.3; font-family: Georgia, serif;">"</div>
                    <p style="margin: 0 0 16px; color: #f1f5f9; font-size: 16px; line-height: 1.7; font-style: italic; position: relative; z-index: 1;">
                      PITCH transformed our business. We closed 40% more deals in the first 90 days. The AI measurements alone saved us thousands.
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 50%; text-align: center; line-height: 44px; color: white; font-weight: 700; font-size: 16px;">MR</div>
                        </td>
                        <td style="padding-left: 12px;">
                          <p style="margin: 0; color: #f1f5f9; font-weight: 600; font-size: 14px;">Mike Rodriguez</p>
                          <p style="margin: 2px 0 0; color: #94a3b8; font-size: 13px;">CEO, Apex Roofing Solutions</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Secondary CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 24px; background: #f8fafc; border-radius: 12px; border: 2px dashed #e2e8f0;">
                    <p style="margin: 0 0 16px; color: #475569; font-size: 15px;">
                      Ready to see the difference?
                    </p>
                    <a href="${onboardingUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
                      Start Your Setup Now
                    </a>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: #0f172a; border-radius: 0 0 24px 24px; padding: 32px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <!-- Support Info -->
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                      <tr>
                        <td style="padding: 0 16px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px;">📞 Questions?</p>
                          <p style="margin: 4px 0 0; color: #f1f5f9; font-size: 14px; font-weight: 600;">Reply to this email</p>
                        </td>
                        <td style="padding: 0 16px; border-right: 1px solid #334155;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px;">⏱️ Setup Time</p>
                          <p style="margin: 4px 0 0; color: #f1f5f9; font-size: 14px; font-weight: 600;">~10 minutes</p>
                        </td>
                        <td style="padding: 0 16px;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px;">🔒 Security</p>
                          <p style="margin: 4px 0 0; color: #f1f5f9; font-size: 14px; font-weight: 600;">256-bit encrypted</p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Link expires notice -->
                    <p style="margin: 0 0 16px; color: #64748b; font-size: 13px;">
                      ⚡ This link expires in 4 hours. If you didn't request this, please ignore this email.
                    </p>
                    
                    <!-- Gold Divider -->
                    <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #d4af37 50%, transparent 100%); margin: 20px 0;"></div>
                    
                    <!-- Copyright -->
                    <p style="margin: 0; color: #64748b; font-size: 12px;">
                      © ${new Date().getFullYear()} PITCH CRM. All rights reserved.<br>
                      <a href="#" style="color: #94a3b8; text-decoration: none;">Privacy Policy</a> • 
                      <a href="#" style="color: #94a3b8; text-decoration: none;">Terms of Service</a> • 
                      <a href="#" style="color: #94a3b8; text-decoration: none;">Unsubscribe</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
  
</body>
</html>
`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { tenant_id, user_id, email, first_name, last_name, company_name }: OnboardingEmailRequest = await req.json();

    if (!tenant_id || !email || !first_name || !company_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Sending premium onboarding email to ${email} for ${company_name}`);

    // Generate unique token
    const token = crypto.randomUUID() + '-' + Date.now().toString(36);
    
    // Token expires in 4 hours for security
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 4);

    // Store token in database
    const { error: tokenError } = await supabase
      .from('company_onboarding_tokens')
      .insert({
        tenant_id,
        user_id,
        email,
        token,
        expires_at: expiresAt.toISOString(),
      });

    if (tokenError) {
      console.error('Failed to create onboarding token:', tokenError);
      return new Response(
        JSON.stringify({ error: "Failed to create onboarding token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build onboarding URL
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-crm.lovable.app";
    const onboardingUrl = `${appUrl}/onboarding/${token}`;

    // Try to fetch custom template from database
    let emailHtml: string;
    let emailSubject: string;
    
    const { data: customTemplate } = await supabase
      .from('email_templates')
      .select('subject, html_body')
      .eq('template_type', 'onboarding')
      .eq('is_active', true)
      .eq('is_default', true)
      .single();
    
    if (customTemplate?.html_body) {
      console.log('Using custom onboarding template from database');
      // Replace variables in template
      emailHtml = customTemplate.html_body
        .replace(/\{\{first_name\}\}/g, first_name)
        .replace(/\{\{company_name\}\}/g, company_name)
        .replace(/\{\{login_url\}\}/g, onboardingUrl);
      emailSubject = customTemplate.subject
        .replace(/\{\{first_name\}\}/g, first_name)
        .replace(/\{\{company_name\}\}/g, company_name);
    } else {
      console.log('Using hardcoded premium onboarding template');
      emailHtml = generatePremiumEmailHtml(first_name, company_name, onboardingUrl);
      emailSubject = `🎉 Welcome to PITCH CRM — Complete Your ${company_name} Setup`;
    }

    let resendMessageId = null;

    // Send email via Resend
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);

      // Get verified domain from env or fallback to resend.dev for testing
      const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
      const fromAddress = `PITCH CRM <onboarding@${fromDomain}>`;
      
      const emailResult = await resend.emails.send({
        from: fromAddress,
        to: [email],
        subject: emailSubject,
        html: emailHtml,
        tags: [
          { name: "email_type", value: "onboarding" },
          { name: "tenant_id", value: tenant_id },
          { name: "campaign", value: "company_onboarding" }
        ],
      });

      console.log('Premium onboarding email sent:', emailResult);
      resendMessageId = emailResult?.data?.id || null;
    } else {
      console.warn('RESEND_API_KEY not configured, skipping email');
    }

    // Log the email send
    const { error: logError } = await supabase
      .from('onboarding_email_log')
      .insert({
        tenant_id,
        recipient_email: email,
        recipient_name: `${first_name} ${last_name || ''}`.trim(),
        sent_by: user_id,
        status: resendMessageId ? 'sent' : 'failed',
        resend_message_id: resendMessageId,
        metadata: { company_name, onboarding_url: onboardingUrl }
      });

    if (logError) {
      console.warn('Failed to log onboarding email:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        token,
        onboarding_url: onboardingUrl,
        expires_at: expiresAt.toISOString(),
        resend_message_id: resendMessageId
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('Onboarding email error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
