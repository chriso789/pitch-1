import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const generatePremiumEmailHtml = (firstName: string, companyName: string, onboardingUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Welcome to PITCH CRM</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); border-radius: 24px 24px 0 0; padding: 0; position: relative; overflow: hidden;">
              <div style="height: 4px; background: linear-gradient(90deg, #d4af37 0%, #f4e4bc 50%, #d4af37 100%);"></div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 48px 40px 32px;">
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
          
          <tr>
            <td style="background: #ffffff; padding: 48px 40px;">
              
              <h2 style="margin: 0 0 16px; font-size: 28px; font-weight: 700; color: #0f172a;">
                Welcome aboard, ${firstName}! 🎉
              </h2>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.7; color: #475569;">
                Your account for <strong style="color: #16a34a;">${companyName}</strong> is ready. You're about to transform how your team sells, manages projects, and closes deals.
              </p>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 24px; border: 1px solid #bbf7d0;">
                    <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #16a34a; text-transform: uppercase; letter-spacing: 1px;">
                      Your Setup Progress
                    </p>
                    <p style="margin: 0; color: #475569; font-size: 14px;">
                      <strong>Step 1 of 5:</strong> Account Activation
                    </p>
                  </td>
                </tr>
              </table>
              
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
              
              <h3 style="margin: 0 0 20px; font-size: 18px; font-weight: 700; color: #0f172a;">
                What You're Getting:
              </h3>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #16a34a;">
                    <p style="margin: 0; font-weight: 600; color: #0f172a;">📞 Power Dialer</p>
                    <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$149/mo value — Triple-line calling, 300 calls/hour</p>
                  </td>
                </tr>
                <tr><td style="height: 12px;"></td></tr>
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #d4af37;">
                    <p style="margin: 0; font-weight: 600; color: #0f172a;">📐 AI Roof Measurements</p>
                    <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$50/report saved — 98% accurate satellite measurements</p>
                  </td>
                </tr>
                <tr><td style="height: 12px;"></td></tr>
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #3b82f6;">
                    <p style="margin: 0; font-weight: 600; color: #0f172a;">📋 Smart Estimates & Contracts</p>
                    <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$99/mo value — Auto-populated, e-signature ready</p>
                  </td>
                </tr>
                <tr><td style="height: 12px;"></td></tr>
                <tr>
                  <td style="padding: 16px; background: #fafafa; border-radius: 12px; border-left: 4px solid #8b5cf6;">
                    <p style="margin: 0; font-weight: 600; color: #0f172a;">🗺️ Territory Mapping</p>
                    <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">$125/mo value — GPS tracking, route optimization</p>
                  </td>
                </tr>
              </table>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; padding: 28px;">
                    <p style="margin: 0 0 16px; color: #f1f5f9; font-size: 16px; line-height: 1.7; font-style: italic;">
                      "PITCH transformed our business. We closed 40% more deals in the first 90 days."
                    </p>
                    <p style="margin: 0; color: #f1f5f9; font-weight: 600; font-size: 14px;">Mike Rodriguez</p>
                    <p style="margin: 2px 0 0; color: #94a3b8; font-size: 13px;">CEO, Apex Roofing Solutions</p>
                  </td>
                </tr>
              </table>
              
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
          
          <tr>
            <td style="background: #0f172a; border-radius: 0 0 24px 24px; padding: 32px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 16px; color: #64748b; font-size: 13px;">
                      ⚡ This is a test email. If you didn't request this, please ignore it.
                    </p>
                    <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #d4af37 50%, transparent 100%); margin: 20px 0;"></div>
                    <p style="margin: 0; color: #64748b; font-size: 12px;">
                      © ${new Date().getFullYear()} PITCH CRM. All rights reserved.
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.error("[send-test-onboarding] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ 
          error: "RESEND_API_KEY not configured",
          hint: "Add RESEND_API_KEY to Edge Function secrets in Supabase Dashboard"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, first_name, company_name } = await req.json();

    if (!email || !first_name || !company_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, first_name, company_name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-test-onboarding] Sending test email to ${email} for ${company_name}`);

    const resend = new Resend(resendApiKey);
    
    // Get verified domain from env or fallback to resend.dev for testing
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromAddress = `PITCH CRM <onboarding@${fromDomain}>`;
    
    const testUrl = "https://pitch-crm.lovable.app/login";
    const emailHtml = generatePremiumEmailHtml(first_name, company_name, testUrl);
    const emailSubject = `🧪 TEST: Welcome to PITCH CRM — ${company_name}`;

    console.log(`[send-test-onboarding] Using from address: ${fromAddress}`);
    console.log(`[send-test-onboarding] Email subject: ${emailSubject}`);

    try {
      const emailResult = await resend.emails.send({
        from: fromAddress,
        to: [email],
        subject: emailSubject,
        html: emailHtml,
        tags: [
          { name: "email_type", value: "test_onboarding" },
          { name: "campaign", value: "test_email" }
        ],
      });

      console.log(`[send-test-onboarding] Resend response:`, JSON.stringify(emailResult));

      if (emailResult.error) {
        console.error(`[send-test-onboarding] Resend error:`, emailResult.error);
        return new Response(
          JSON.stringify({ 
            error: emailResult.error.message || "Resend API error",
            resend_error: emailResult.error
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          resend_id: emailResult.data?.id,
          sent_to: email,
          from: fromAddress,
          subject: emailSubject,
          message: `Test email successfully sent to ${email}`
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (resendError: any) {
      console.error(`[send-test-onboarding] Resend send error:`, resendError);
      return new Response(
        JSON.stringify({ 
          error: resendError.message || "Failed to send email via Resend",
          details: resendError.toString()
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error: any) {
    console.error("[send-test-onboarding] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
