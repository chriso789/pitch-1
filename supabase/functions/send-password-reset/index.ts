import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PasswordResetRequest {
  email: string;
  redirectUrl?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, redirectUrl }: PasswordResetRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Password reset request for:", email);

    // Initialize Supabase Admin Client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Check if user exists by looking up in profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, email, tenant_id")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    // Always respond with success for security (don't reveal if email exists)
    // But only send email if user exists
    if (!profile) {
      console.log("No profile found for email:", email);
      // Return success anyway for security
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "If an account exists, a password reset email has been sent" 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user from auth.users to verify they exist in auth system
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!authUser) {
      console.log("No auth user found for email:", email);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "If an account exists, a password reset email has been sent" 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate password reset link via Supabase Admin API
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: authUser.email!,
      options: {
        redirectTo: redirectUrl || 'https://id-preview--6af530d9-2698-4529-aba4-165abe9112fb.lovable.app/reset-password'
      }
    });

    if (linkError) {
      console.error("Error generating reset link:", linkError);
      throw new Error("Failed to generate reset link");
    }

    const resetLink = linkData.properties?.action_link;
    if (!resetLink) {
      console.error("No reset link generated");
      throw new Error("Failed to generate reset link");
    }

    console.log("Generated reset link for:", email);

    // Get company name for branding
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", profile.tenant_id)
      .maybeSingle();

    const companyName = tenant?.name || "PITCH CRM";
    const firstName = profile.first_name || "there";
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";

    // Send password reset email via Resend
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f4f4f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <div style="width: 64px; height: 64px; margin: 0 auto 20px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); border-radius: 16px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 32px;">🔐</span>
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #18181b;">
                Reset Your Password
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 24px; color: #52525b;">
                Hi ${firstName},
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 24px; color: #52525b;">
                We received a request to reset your password for your <strong>${companyName}</strong> account. Click the button below to set a new password:
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin: 30px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${resetLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 22px; color: #71717a;">
                ⏰ This link will expire in <strong>1 hour</strong> for security reasons.
              </p>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 22px; color: #71717a;">
                If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          
          <!-- Link fallback -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="padding: 16px; background-color: #f4f4f5; border-radius: 8px;">
                <p style="margin: 0 0 8px; font-size: 12px; color: #71717a;">
                  If the button doesn't work, copy and paste this link:
                </p>
                <p style="margin: 0; font-size: 11px; color: #2563eb; word-break: break-all;">
                  ${resetLink}
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">
                © ${new Date().getFullYear()} ${companyName}. All rights reserved.
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

    const emailResponse = await resend.emails.send({
      from: `${companyName} <noreply@${fromDomain}>`,
      to: [email],
      subject: `Reset your ${companyName} password`,
      html: emailHtml,
    });

    if (emailResponse.error) {
      console.error("Resend API error:", emailResponse.error);
      throw new Error(`Failed to send email: ${emailResponse.error.message}`);
    }

    console.log("Password reset email sent successfully to:", email, "ID:", emailResponse.data?.id);

    // Log the activity
    await supabaseAdmin
      .from("audit_log")
      .insert({
        tenant_id: profile.tenant_id,
        table_name: "auth.users",
        record_id: authUser.id,
        action: "PASSWORD_RESET_REQUESTED",
        new_values: { email, method: "resend_email" },
        changed_by: authUser.id
      })
      .then(({ error }) => {
        if (error) console.error("Failed to log audit:", error);
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password reset email sent successfully" 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in send-password-reset:", error);
    // Always return success for security
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "If an account exists, a password reset email has been sent" 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
