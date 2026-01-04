import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProvisionOwnerRequest {
  tenant_id: string;
  send_email?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { tenant_id, send_email = true }: ProvisionOwnerRequest = await req.json();

    console.log("[provision-tenant-owner] Starting provisioning for tenant:", tenant_id);

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Load tenant info to get owner details
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name, subdomain, owner_email, owner_name, owner_phone")
      .eq("id", tenant_id)
      .single();

    if (tenantError || !tenant) {
      console.error("[provision-tenant-owner] Tenant not found:", tenantError);
      return new Response(
        JSON.stringify({ error: "Tenant not found", details: tenantError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ownerEmail = tenant.owner_email;
    if (!ownerEmail) {
      return new Response(
        JSON.stringify({ error: "Tenant has no owner_email configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse owner name
    const ownerName = tenant.owner_name || "";
    const nameParts = ownerName.split(" ");
    const firstName = nameParts[0] || "Owner";
    const lastName = nameParts.slice(1).join(" ") || "";

    console.log("[provision-tenant-owner] Owner info:", { 
      email: ownerEmail, 
      firstName, 
      lastName, 
      phone: tenant.owner_phone 
    });

    // Step 2: Check if auth user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      u => u.email?.toLowerCase() === ownerEmail.toLowerCase()
    );

    let userId: string;
    let isNewUser = false;

    if (existingUser) {
      console.log("[provision-tenant-owner] Auth user already exists:", existingUser.id);
      userId = existingUser.id;
    } else {
      // Create new auth user with random password (they'll set it via invite link)
      const tempPassword = crypto.randomUUID() + crypto.randomUUID();
      
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`.trim(),
        },
      });

      if (createError) {
        console.error("[provision-tenant-owner] Error creating auth user:", createError);
        return new Response(
          JSON.stringify({ error: "Failed to create auth user", details: createError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = newUser.user.id;
      isNewUser = true;
      console.log("[provision-tenant-owner] Created new auth user:", userId);
    }

    // Step 3: Create or update profile (DO NOT store role here - use user_roles table)
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: userId,
        tenant_id: tenant_id,
        email: ownerEmail,
        first_name: firstName,
        last_name: lastName,
        phone: tenant.owner_phone || null,
        is_active: true,
        active_tenant_id: tenant_id,
      }, {
        onConflict: "id",
      });

    if (profileError) {
      console.error("[provision-tenant-owner] Error creating/updating profile:", profileError);
      // Log but don't fail
    } else {
      console.log("[provision-tenant-owner] Profile created/updated for user:", userId);
    }

    // Step 4: Create user_roles entry (SECURITY: roles must be in separate table)
    const { error: roleError } = await supabase
      .from("user_roles")
      .upsert({
        user_id: userId,
        tenant_id: tenant_id,
        role: "owner",
      }, {
        onConflict: "user_id,tenant_id",
      });

    if (roleError) {
      console.error("[provision-tenant-owner] Error creating user role:", roleError);
    } else {
      console.log("[provision-tenant-owner] User role 'owner' created for user:", userId);
    }

    // Step 5: Add user to user_company_access
    const { error: accessError } = await supabase
      .from("user_company_access")
      .upsert({
        user_id: userId,
        tenant_id: tenant_id,
        access_level: "full",
        is_active: true,
        granted_by: userId,
      }, {
        onConflict: "user_id,tenant_id",
      });

    if (accessError) {
      console.error("[provision-tenant-owner] Error granting company access:", accessError);
    } else {
      console.log("[provision-tenant-owner] Company access granted for user:", userId);
    }

    // Step 5: Generate invite link (for password setup) - use APP_URL env var with reliable production fallback
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-1.lovable.app";
    const resetRedirectUrl = `${appUrl}/reset-password?onboarding=true`;
    
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
      type: "invite",
      email: ownerEmail,
      options: {
        redirectTo: resetRedirectUrl,
      },
    });

    let inviteLink: string | null = null;
    if (inviteError) {
      console.error("[provision-tenant-owner] Error generating invite link:", inviteError);
      // Try recovery link as fallback
      const { data: recoveryData } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: ownerEmail,
        options: {
          redirectTo: resetRedirectUrl,
        },
      });
      inviteLink = recoveryData?.properties?.action_link || null;
    } else {
      inviteLink = inviteData?.properties?.action_link || null;
    }

    console.log("[provision-tenant-owner] Generated invite link:", inviteLink ? "Yes" : "No");

    // Step 6: Send email if requested and we have a link
    let emailSent = false;
    if (send_email && inviteLink && resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        
        const emailHtml = generateSetupEmailHtml(firstName, tenant.name, inviteLink, appUrl);
        
        const { data: emailData, error: emailError } = await resend.emails.send({
          from: "PITCH CRM <onboarding@mail.pitchcrm.io>",
          to: [ownerEmail],
          bcc: ["support@obriencontractingusa.com"],
          subject: `🔐 Set Your Password - ${tenant.name} Account Ready`,
          html: emailHtml,
        });

        if (emailError) {
          console.error("[provision-tenant-owner] Email send error:", emailError);
        } else {
          emailSent = true;
          console.log("[provision-tenant-owner] Setup email sent successfully:", emailData?.id);
        }
      } catch (emailErr: any) {
        console.error("[provision-tenant-owner] Email exception:", emailErr);
      }
    }

    // Step 7: Log activity
    try {
      await supabase.from("company_activity_log").insert({
        tenant_id: tenant_id,
        action_type: "owner_provisioned",
        severity: "info",
        description: `Owner account provisioned for ${ownerEmail}`,
        metadata: {
          user_id: userId,
          email: ownerEmail,
          is_new_user: isNewUser,
          email_sent: emailSent,
        },
      });
    } catch (logErr) {
      console.error("[provision-tenant-owner] Failed to log activity:", logErr);
    }

    // Step 8: Log to onboarding_email_log
    try {
      await supabase.from("onboarding_email_log").insert({
        tenant_id: tenant_id,
        recipient_email: ownerEmail,
        recipient_name: `${firstName} ${lastName}`.trim(),
        email_type: "owner_setup",
        status: emailSent ? "sent" : (inviteLink ? "link_generated" : "failed"),
        metadata: {
          user_id: userId,
          is_new_user: isNewUser,
          has_invite_link: !!inviteLink,
        },
      });
    } catch (logErr) {
      console.error("[provision-tenant-owner] Failed to log onboarding:", logErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email: ownerEmail,
        is_new_user: isNewUser,
        invite_link: inviteLink,
        email_sent: emailSent,
        message: isNewUser 
          ? `Created new owner account for ${ownerEmail}` 
          : `Updated existing owner account for ${ownerEmail}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[provision-tenant-owner] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Email template for password setup
function generateSetupEmailHtml(firstName: string, companyName: string, setupLink: string, loginUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Set Your Password - ${companyName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 48px 24px;">
        
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); border-radius: 24px 24px 0 0; padding: 40px; text-align: center;">
              <div style="height: 4px; background: linear-gradient(90deg, #d4af37 0%, #f4e4bc 50%, #d4af37 100%); border-radius: 24px 24px 0 0; margin: -40px -40px 24px;"></div>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="padding-right: 12px; vertical-align: middle;">
                    <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #16a34a 0%, #0d9488 100%); border-radius: 12px; text-align: center; line-height: 48px;">
                      <span style="font-size: 26px; font-weight: 800; color: white;">P</span>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 28px; font-weight: 800; color: #ffffff;">PITCH</span>
                    <span style="font-size: 28px; font-weight: 800; color: #d4af37;"> CRM</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="background: #ffffff; padding: 48px;">
              
              <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: 700; color: #0f172a;">
                Set Your Password 🔐
              </h1>
              
              <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.6; color: #475569;">
                Hi ${firstName},<br><br>
                Your <strong style="color: #16a34a;">${companyName}</strong> account is ready! 
                Click the button below to set your password and access your account.
              </p>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 32px;">
                <tr>
                  <td align="center">
                    <a href="${setupLink}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; text-decoration: none; padding: 18px 48px; border-radius: 12px; font-size: 18px; font-weight: 700; box-shadow: 0 8px 24px rgba(22, 163, 74, 0.35);">
                      Set My Password →
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 24px; color: #64748b; font-size: 14px; text-align: center;">
                This link expires in 24 hours. Need a new link? Contact your administrator.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
              
              <p style="margin: 0; color: #94a3b8; font-size: 14px; text-align: center;">
                After setting your password, log in at:<br>
                <a href="${loginUrl}/login" style="color: #16a34a; text-decoration: none;">${loginUrl}/login</a>
              </p>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: #1e293b; border-radius: 0 0 24px 24px; padding: 24px; text-align: center;">
              <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                © ${new Date().getFullYear()} PITCH CRM. All rights reserved.
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
}
