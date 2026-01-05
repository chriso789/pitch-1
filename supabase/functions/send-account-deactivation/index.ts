import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Admin BCC for all deactivation emails
const ADMIN_BCC = 'chrisobrien91@gmail.com';

interface DeactivationEmailRequest {
  tenant_id: string;
  owner_email: string;
  owner_name: string;
  company_name: string;
}

// Professional farewell email template
const generateDeactivationEmailHtml = (ownerName: string, companyName: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank You from PITCH CRM</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    Thank you for being part of PITCH CRM. We wish you the best in your future endeavors.
  </div>
  
  <!-- Main Container -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);">
    <tr>
      <td align="center" style="padding: 48px 24px;">
        
        <!-- Email Card -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); border-radius: 24px 24px 0 0; padding: 0;">
              <!-- Gold accent bar -->
              <div style="height: 5px; background: linear-gradient(90deg, #d4af37 0%, #f4e4bc 25%, #d4af37 50%, #f4e4bc 75%, #d4af37 100%); border-radius: 24px 24px 0 0;"></div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 48px 48px 40px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <!-- Logo -->
                          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                            <tr>
                              <td style="padding-right: 16px; vertical-align: middle;">
                                <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #16a34a 0%, #0d9488 100%); border-radius: 14px; text-align: center; line-height: 56px; box-shadow: 0 8px 32px rgba(22, 163, 74, 0.4);">
                                  <span style="font-size: 28px; font-weight: 800; color: white;">P</span>
                                </div>
                              </td>
                              <td style="vertical-align: middle;">
                                <span style="font-size: 32px; font-weight: 800; color: #ffffff;">PITCH</span>
                                <span style="font-size: 32px; font-weight: 800; color: #d4af37;"> CRM</span>
                              </td>
                            </tr>
                          </table>
                          <p style="margin: 0; color: #94a3b8; font-size: 14px; letter-spacing: 2px; text-transform: uppercase;">
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
            <td style="background: #ffffff; padding: 48px;">
              
              <!-- Farewell Icon -->
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 50%; line-height: 80px; font-size: 40px;">
                  👋
                </div>
              </div>
              
              <!-- Greeting -->
              <h2 style="margin: 0 0 24px; font-size: 28px; font-weight: 700; color: #0f172a; text-align: center; line-height: 1.3;">
                Thank You, ${ownerName}
              </h2>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.7; color: #475569; text-align: center;">
                We wanted to take a moment to personally thank you for being part of the <strong style="color: #16a34a;">PITCH CRM</strong> family.
              </p>
              
              <!-- Account Status Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 16px; padding: 24px; border-left: 5px solid #f59e0b;">
                    <p style="margin: 0; font-size: 16px; color: #78350f; text-align: center;">
                      <strong>Account Status:</strong> Your <strong>${companyName}</strong> account has been deactivated.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.7; color: #475569;">
                We truly appreciate the time you spent with us and hope that PITCH CRM helped your business during our partnership together.
              </p>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.7; color: #475569;">
                As you move forward on your business journey, we wish you nothing but success with your next CRM solution and continued growth for <strong>${companyName}</strong>.
              </p>
              
              <!-- Data Preservation Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 24px; border: 1px solid #bbf7d0;">
                    <p style="margin: 0; font-size: 15px; color: #166534; text-align: center;">
                      <strong>💾 Your data is safely preserved.</strong><br>
                      Should you ever decide to return, we'd love to welcome you back!
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Signature -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 32px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 8px; font-size: 17px; font-weight: 600; color: #0f172a;">
                      Wishing you all the best,
                    </p>
                    <p style="margin: 0 0 4px; font-size: 16px; color: #16a34a; font-weight: 600;">
                      The PITCH CRM Team
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #94a3b8;">
                      Questions? Contact us at <a href="mailto:support@pitch-crm.ai" style="color: #16a34a; text-decoration: none;">support@pitch-crm.ai</a>
                    </p>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: #0f172a; border-radius: 0 0 24px 24px; padding: 32px 48px; text-align: center;">
              <p style="margin: 0 0 12px; color: #94a3b8; font-size: 13px;">
                © ${new Date().getFullYear()} PITCH CRM. All rights reserved.
              </p>
              <p style="margin: 0; color: #64748b; font-size: 12px;">
                This email was sent because your account was deactivated.
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

const handler = async (req: Request): Promise<Response> => {
  console.log("[send-account-deactivation] Function invoked");
  
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[send-account-deactivation] RESEND_API_KEY not configured");
      throw new Error("Email service not configured");
    }

    const resend = new Resend(resendApiKey);
    
    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { tenant_id, owner_email, owner_name, company_name }: DeactivationEmailRequest = await req.json();
    
    console.log("[send-account-deactivation] Processing deactivation email:", {
      tenant_id,
      owner_email,
      company_name,
    });

    // Validate required fields
    if (!owner_email || !owner_name || !company_name) {
      throw new Error("Missing required fields: owner_email, owner_name, or company_name");
    }

    // Get first name for personalization
    const firstName = owner_name.split(' ')[0] || owner_name;

    // Generate email HTML
    const emailHtml = generateDeactivationEmailHtml(firstName, company_name);

    // Get from domain from environment
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN");
    const fromEmail = fromDomain ? `noreply@${fromDomain}` : "onboarding@resend.dev";

    // Send the farewell email
    const emailResponse = await resend.emails.send({
      from: `PITCH CRM <${fromEmail}>`,
      to: [owner_email],
      bcc: [ADMIN_BCC],
      subject: "Thank You for Being Part of PITCH CRM",
      html: emailHtml,
    });

    console.log("[send-account-deactivation] Email sent successfully:", emailResponse);

    // Log to audit table
    if (tenant_id) {
      await supabase.from('audit_log').insert({
        table_name: 'tenants',
        action: 'deactivation_email_sent',
        record_id: tenant_id,
        new_values: {
          owner_email,
          owner_name,
          company_name,
          sent_at: new Date().toISOString(),
          email_id: emailResponse.data?.id,
        },
      });
      console.log("[send-account-deactivation] Audit log entry created");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Deactivation email sent successfully",
        email_id: emailResponse.data?.id,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("[send-account-deactivation] Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
