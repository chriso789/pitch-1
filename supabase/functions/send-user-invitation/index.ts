import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  // Company branding
  companyLogo?: string;
  companyPrimaryColor?: string;
  companySecondaryColor?: string;
  // Owner personal touch
  ownerName?: string;
  ownerHeadshot?: string;
  ownerTitle?: string;
  ownerEmail?: string;
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
    settingsLink,
    companyLogo,
    companyPrimaryColor,
    companySecondaryColor,
    ownerName,
    ownerHeadshot,
    ownerTitle
  } = data;
  
  // Use company colors or defaults
  const primaryColor = companyPrimaryColor || '#1e40af';
  const secondaryColor = companySecondaryColor || '#3b82f6';
  
  const roleDisplayName = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Role-specific descriptions
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

  const subject = `Welcome to ${companyName} - Your Account is Ready! 🎉`;

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
        Welcome to the Team, ${firstName}! 🎉
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 16px;">
        Your ${roleDisplayName} account is ready
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
        You've been added as a <strong style="color: ${primaryColor};">${roleDisplayName}</strong> at <strong>${companyName}</strong>.
      </p>
      
      <p style="font-size: 16px; color: #6b7280; line-height: 1.7; margin: 0 0 24px 0;">
        ${description}
      </p>
      
      ${payStructureSection}
      
      <!-- CTA Button -->
      <div style="text-align: center; margin: 32px 0;">
        ${passwordSetupLink ? `
          <a 
            href="${passwordSetupLink}" 
            style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); color: white; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px ${primaryColor}40;"
          >
            Set Up Your Password
          </a>
          <p style="margin: 16px 0 0 0; font-size: 13px; color: #9ca3af;">
            This link expires in 24 hours
          </p>
        ` : `
          <p style="color: #6b7280; font-size: 14px; margin: 0;">
            Your administrator will provide your login credentials.
          </p>
        `}
      </div>
      
      ${settingsLink ? `
        <p style="font-size: 14px; color: #6b7280; text-align: center; margin: 24px 0 0 0;">
          After setting your password, <a href="${settingsLink}" style="color: ${primaryColor}; font-weight: 500;">complete your profile</a> to add your photo and details.
        </p>
      ` : ''}
      
      ${ownerSection}
      
      <!-- Footer -->
      <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 32px; text-align: center;">
        <p style="font-size: 13px; color: #9ca3af; margin: 0 0 8px 0;">
          Questions? Contact your system administrator for assistance.
        </p>
        <p style="font-size: 12px; color: #d1d5db; margin: 0;">
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
    const { email, companyName } = requestData;

    // Admin BCC for all user creation emails
    const ADMIN_BCC_EMAIL = 'chris@obriencontractingusa.com';

    console.log('Sending personalized onboarding email to:', email, 'for company:', companyName);
    console.log('BCC copy to:', ADMIN_BCC_EMAIL);
    console.log('User details:', {
      email,
      firstName: requestData.firstName,
      lastName: requestData.lastName,
      role: requestData.role,
      company: companyName,
      payType: requestData.payType,
      hourlyRate: requestData.hourlyRate,
      commissionRate: requestData.commissionRate
    });
    console.log('Company branding:', {
      logo: requestData.companyLogo ? 'provided' : 'none',
      primaryColor: requestData.companyPrimaryColor,
      ownerName: requestData.ownerName,
      ownerHeadshot: requestData.ownerHeadshot ? 'provided' : 'none'
    });

    const { subject, html } = getEmailTemplate(requestData);

    // Sanitize company name for email "from" field - remove special characters
    const sanitizedCompanyName = (companyName || 'PITCH CRM').replace(/[<>'"]/g, '');
    
    // Use verified domain from environment
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromEmail = `onboarding@${fromDomain}`;
    
    console.log('Sending from:', `${sanitizedCompanyName} <${fromEmail}>`);
    console.log('Sending TO:', email);

    const emailResponse = await resend.emails.send({
      from: `${sanitizedCompanyName} <${fromEmail}>`,
      to: [email],
      bcc: [ADMIN_BCC_EMAIL],
      subject,
      html,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    console.error("Error in send-user-invitation function:", error);
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