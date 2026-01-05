import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Centralized email config
const EMAIL_CONFIG = {
  bcc: 'chrisobrien91@gmail.com',
  brand: {
    name: 'PITCH CRM',
    primaryColor: '#2563eb',
    secondaryColor: '#3b82f6',
  },
  urls: {
    app: 'https://pitch-1.lovable.app',
    login: 'https://pitch-1.lovable.app/login',
  },
  linkExpirationHours: 24,
};

/**
 * Convert Supabase action_link to direct app setup link
 * This bypasses Supabase redirect configuration entirely.
 */
function buildDirectSetupLink(actionLink: string): string {
  try {
    const url = new URL(actionLink);
    const tokenHash = url.searchParams.get('token');
    const type = url.searchParams.get('type') || 'invite';
    
    if (!tokenHash) {
      console.warn('[buildDirectSetupLink] No token found in action_link, returning original');
      return actionLink;
    }
    
    const directLink = `${EMAIL_CONFIG.urls.app}/setup-account?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`;
    console.log('[buildDirectSetupLink] Converted to direct link');
    return directLink;
  } catch (err) {
    console.error('[buildDirectSetupLink] Failed to parse action_link:', err);
    return actionLink;
  }
}

function getFromEmail(): string {
  const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN");
  if (fromDomain) {
    return `onboarding@${fromDomain}`;
  }
  return 'onboarding@resend.dev';
}

interface UserInvitationRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: string;
  companyName: string;
  payType?: 'hourly' | 'commission';
  hourlyRate?: number;
  commissionRate?: number;
  overheadRate?: number;
  passwordSetupLink?: string;
  settingsLink?: string;
  loginUrl?: string;
  companyLogo?: string;
  companyPrimaryColor?: string;
  companySecondaryColor?: string;
  ownerName?: string;
  ownerHeadshot?: string;
  ownerTitle?: string;
  ownerEmail?: string;
  tenantId?: string;
}

const getEmailTemplate = (data: UserInvitationRequest): { subject: string; html: string } => {
  const { 
    firstName, 
    role, 
    companyName, 
    payType, 
    hourlyRate, 
    commissionRate, 
    overheadRate, 
    passwordSetupLink, 
    loginUrl,
    companyLogo,
    companyPrimaryColor,
    companySecondaryColor,
    ownerName,
    ownerHeadshot,
    ownerTitle
  } = data;
  
  const primaryColor = companyPrimaryColor || EMAIL_CONFIG.brand.primaryColor;
  const secondaryColor = companySecondaryColor || EMAIL_CONFIG.brand.secondaryColor;
  const displayLoginUrl = loginUrl || EMAIL_CONFIG.urls.login;
  
  const roleDisplayName = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  const roleDescriptions: Record<string, string> = {
    owner: 'As an Owner, you have full access to manage your company, team members, and all business operations.',
    corporate: 'You have company-wide visibility and team leadership capabilities across all locations.',
    office_admin: 'You can manage office operations, users, and administrative tasks for your location.',
    regional_manager: 'You oversee regional operations, teams, and performance across your assigned territory.',
    sales_manager: 'You lead the sales team and drive revenue growth for the company.',
    project_manager: 'You manage project execution, field operations, and ensure successful project delivery.',
  };

  const description = roleDescriptions[role] || roleDescriptions.project_manager;

  // Build pay structure section for sales roles
  let payStructureSection = '';
  if (['sales_manager', 'regional_manager'].includes(role)) {
    if (payType === 'hourly' && hourlyRate) {
      payStructureSection = `
        <div style="background: linear-gradient(135deg, ${primaryColor}10 0%, ${secondaryColor}10 100%); border: 1px solid ${primaryColor}30; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="margin: 0 0 16px 0; color: ${primaryColor}; font-size: 16px; font-weight: 600;">
            💰 Your Compensation Structure
          </h3>
          <div style="display: grid; gap: 12px;">
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${primaryColor}20;">
              <span style="color: #6b7280;">Pay Type:</span>
              <strong style="color: #374151;">Hourly</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 10px 0;">
              <span style="color: #6b7280;">Hourly Rate:</span>
              <strong style="color: ${primaryColor}; font-size: 18px;">$${hourlyRate}/hour</strong>
            </div>
          </div>
        </div>
      `;
    } else if (commissionRate) {
      payStructureSection = `
        <div style="background: linear-gradient(135deg, ${primaryColor}10 0%, ${secondaryColor}10 100%); border: 1px solid ${primaryColor}30; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="margin: 0 0 16px 0; color: ${primaryColor}; font-size: 16px; font-weight: 600;">
            💰 Your Compensation Structure
          </h3>
          <div style="display: grid; gap: 12px;">
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${primaryColor}20;">
              <span style="color: #6b7280;">Pay Type:</span>
              <strong style="color: #374151;">Commission</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${primaryColor}20;">
              <span style="color: #6b7280;">Commission Rate:</span>
              <strong style="color: ${primaryColor}; font-size: 18px;">${commissionRate}% Profit Split</strong>
            </div>
            ${overheadRate ? `
            <div style="display: flex; justify-content: space-between; padding: 10px 0;">
              <span style="color: #6b7280;">Overhead Rate:</span>
              <strong style="color: #374151;">${overheadRate}%</strong>
            </div>
            ` : ''}
          </div>
        </div>
      `;
    }
  }

  // Build owner personal message section
  let ownerSection = '';
  if (ownerName) {
    ownerSection = `
      <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #e5e7eb;">
        <div style="display: flex; align-items: flex-start; gap: 16px;">
          ${ownerHeadshot ? `
            <img 
              src="${ownerHeadshot}" 
              alt="${ownerName}" 
              style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 3px solid ${primaryColor};"
            />
          ` : `
            <div style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold;">
              ${ownerName.charAt(0).toUpperCase()}
            </div>
          `}
          <div style="flex: 1;">
            <p style="margin: 0 0 8px 0; font-style: italic; color: #4b5563; font-size: 15px; line-height: 1.6;">
              "Welcome to the ${companyName} family! We're thrilled to have you join our team. I'm personally excited about what we'll accomplish together. Don't hesitate to reach out if you need anything!"
            </p>
            <p style="margin: 0; font-weight: 600; color: ${primaryColor};">
              — ${ownerName}
            </p>
            <p style="margin: 4px 0 0 0; font-size: 13px; color: #6b7280;">
              ${ownerTitle || 'Owner'}, ${companyName}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  const subject = `🎉 Welcome to ${companyName} - Create Your Password`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    
    <!-- Header with company branding -->
    <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); padding: 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
      ${companyLogo ? `
        <img 
          src="${companyLogo}" 
          alt="${companyName}" 
          style="max-height: 60px; max-width: 200px; margin-bottom: 20px;"
        />
      ` : `
        <div style="margin-bottom: 16px;">
          <span style="font-size: 32px; font-weight: bold; color: white;">${companyName}</span>
        </div>
      `}
      <h1 style="color: white; margin: 0 0 8px 0; font-size: 28px; font-weight: 700;">
        Welcome, ${firstName}! 🎉
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 18px; font-weight: 500;">
        You've been added to ${companyName}
      </p>
    </div>
    
    <!-- Main content -->
    <div style="background: white; padding: 40px 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      
      <!-- Role badge -->
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="display: inline-block; background: linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}15 100%); color: ${primaryColor}; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600; border: 1px solid ${primaryColor}30;">
          ${roleDisplayName}
        </span>
      </div>
      
      <p style="font-size: 16px; color: #374151; line-height: 1.7; margin: 0 0 16px 0;">
        Great news! You've been added to <strong style="color: ${primaryColor};">${companyName}</strong> as a <strong>${roleDisplayName}</strong>.
      </p>
      
      <p style="font-size: 16px; color: #6b7280; line-height: 1.7; margin: 0 0 24px 0;">
        ${description}
      </p>
      
      ${payStructureSection}
      
      <!-- Getting Started Box -->
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border: 1px solid #86efac; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="margin: 0 0 16px 0; color: #166534; font-size: 16px; font-weight: 600;">
          📋 Getting Started
        </h3>
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="padding-bottom: 12px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width: 28px; height: 28px; background-color: #22c55e; border-radius: 50%; text-align: center; vertical-align: middle;">
                    <span style="color: white; font-weight: bold; font-size: 14px; line-height: 28px;">1</span>
                  </td>
                  <td style="padding-left: 12px; color: #374151; font-size: 15px;"><strong>Create your password</strong> using the button below</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 12px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width: 28px; height: 28px; background-color: #22c55e; border-radius: 50%; text-align: center; vertical-align: middle;">
                    <span style="color: white; font-weight: bold; font-size: 14px; line-height: 28px;">2</span>
                  </td>
                  <td style="padding-left: 12px; color: #374151; font-size: 15px;"><strong>Log in</strong> and explore the CRM</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width: 28px; height: 28px; background-color: #22c55e; border-radius: 50%; text-align: center; vertical-align: middle;">
                    <span style="color: white; font-weight: bold; font-size: 14px; line-height: 28px;">3</span>
                  </td>
                  <td style="padding-left: 12px; color: #374151; font-size: 15px;"><strong>Complete your profile</strong> in Settings</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
      
      <!-- CTA Button -->
      <div style="text-align: center; margin: 32px 0;">
        ${passwordSetupLink ? `
          <a 
            href="${passwordSetupLink}" 
            style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); color: white; padding: 18px 48px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 18px; box-shadow: 0 4px 14px ${primaryColor}40;"
          >
            Create My Password →
          </a>
          <p style="margin: 16px 0 0 0; font-size: 13px; color: #9ca3af;">
            ⏰ This link expires in ${EMAIL_CONFIG.linkExpirationHours} hours
          </p>
        ` : `
          <a 
            href="${displayLoginUrl}" 
            style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); color: white; padding: 18px 48px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 18px; box-shadow: 0 4px 14px ${primaryColor}40;"
          >
            Go to Login →
          </a>
        `}
      </div>
      
      ${ownerSection}
      
      <!-- Footer with explicit login URL -->
      <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 32px;">
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <p style="font-size: 13px; color: #6b7280; margin: 0 0 4px 0;">
            <strong>Login URL:</strong>
          </p>
          <a href="${displayLoginUrl}" style="font-size: 14px; color: ${primaryColor}; font-weight: 500; text-decoration: none;">
            ${displayLoginUrl}
          </a>
        </div>
        <p style="font-size: 13px; color: #9ca3af; margin: 0 0 8px 0; text-align: center;">
          Questions? Reply to this email for support.
        </p>
        <p style="font-size: 12px; color: #d1d5db; margin: 0; text-align: center;">
          © ${new Date().getFullYear()} ${companyName}. All rights reserved.
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;

  return { subject, html };
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestData: UserInvitationRequest = await req.json();
    const { email, companyName, tenantId } = requestData;

    console.log('[send-user-invitation] Sending personalized onboarding email to:', email, 'for company:', companyName);

    const { subject, html } = getEmailTemplate(requestData);

    // Sanitize company name for email "from" field
    const sanitizedCompanyName = (companyName || 'PITCH CRM').replace(/[<>'"]/g, '');
    const fromEmail = getFromEmail();
    
    console.log('[send-user-invitation] Sending from:', `${sanitizedCompanyName} <${fromEmail}>`);

    const emailResponse = await resend.emails.send({
      from: `${sanitizedCompanyName} <${fromEmail}>`,
      to: [email],
      bcc: [EMAIL_CONFIG.bcc],
      subject,
      html,
    });

    console.log("[send-user-invitation] Email sent successfully:", emailResponse);

    // Log to onboarding_email_log if tenantId provided
    if (tenantId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        const expiresAt = new Date(Date.now() + EMAIL_CONFIG.linkExpirationHours * 60 * 60 * 1000);

        await supabase.from('onboarding_email_log').insert({
          tenant_id: tenantId,
          recipient_email: email,
          recipient_name: `${requestData.firstName} ${requestData.lastName}`,
          status: 'sent',
          resend_message_id: emailResponse.data?.id || null,
          sent_at: new Date().toISOString(),
          email_type: 'user_invite',
          email_body: html,
          expires_at: expiresAt.toISOString(),
          metadata: {
            role: requestData.role,
            company_name: companyName,
          },
        });
      } catch (logError) {
        console.error('[send-user-invitation] Failed to log email:', logError);
      }
    }

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    console.error("[send-user-invitation] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
