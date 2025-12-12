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
}

// Role-specific email templates
const getEmailTemplate = (data: UserInvitationRequest): { subject: string; html: string } => {
  const { firstName, role, companyName, payType, hourlyRate, commissionRate, overheadRate, passwordSetupLink, settingsLink } = data;
  
  const baseStyles = `
    font-family: Arial, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    background-color: #f9fafb;
  `;

  const buttonStyle = (gradient: string) => `
    display: inline-block;
    background: ${gradient};
    color: white;
    padding: 14px 32px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: bold;
    font-size: 16px;
  `;

  // Role-specific configurations
  const roleConfigs: Record<string, { gradient: string; lightBg: string; border: string; textColor: string }> = {
    owner: { gradient: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)', lightBg: '#eff6ff', border: '#bfdbfe', textColor: '#1e40af' },
    corporate: { gradient: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)', lightBg: '#f5f3ff', border: '#ddd6fe', textColor: '#7c3aed' },
    office_admin: { gradient: 'linear-gradient(135deg, #059669 0%, #34d399 100%)', lightBg: '#ecfdf5', border: '#a7f3d0', textColor: '#059669' },
    regional_manager: { gradient: 'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)', lightBg: '#fffbeb', border: '#fde68a', textColor: '#d97706' },
    sales_manager: payType === 'hourly' 
      ? { gradient: 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)', lightBg: '#fff7ed', border: '#fed7aa', textColor: '#ea580c' }
      : { gradient: 'linear-gradient(135deg, #dc2626 0%, #f87171 100%)', lightBg: '#fef2f2', border: '#fecaca', textColor: '#dc2626' },
    project_manager: { gradient: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)', lightBg: '#ecfeff', border: '#a5f3fc', textColor: '#0891b2' },
  };

  const config = roleConfigs[role] || roleConfigs.project_manager;
  const roleDisplayName = role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Build pay structure section for sales roles
  let payStructureSection = '';
  if (['sales_manager', 'regional_manager'].includes(role)) {
    if (payType === 'hourly' && hourlyRate) {
      payStructureSection = `
        <div style="background: ${config.lightBg}; border: 1px solid ${config.border}; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: ${config.textColor}; font-size: 16px;">💰 Your Compensation Structure</h3>
          <div style="display: grid; gap: 10px;">
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${config.border};">
              <span style="color: #6b7280;">Pay Type:</span>
              <strong style="color: #374151;">Hourly</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0;">
              <span style="color: #6b7280;">Hourly Rate:</span>
              <strong style="color: ${config.textColor};">$${hourlyRate}/hour</strong>
            </div>
          </div>
        </div>
      `;
    } else if (commissionRate) {
      payStructureSection = `
        <div style="background: ${config.lightBg}; border: 1px solid ${config.border}; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: ${config.textColor}; font-size: 16px;">💰 Your Compensation Structure</h3>
          <div style="display: grid; gap: 10px;">
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${config.border};">
              <span style="color: #6b7280;">Pay Type:</span>
              <strong style="color: #374151;">Commission</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${config.border};">
              <span style="color: #6b7280;">Commission Rate:</span>
              <strong style="color: ${config.textColor};">${commissionRate}% Profit Split</strong>
            </div>
            ${overheadRate ? `
            <div style="display: flex; justify-content: space-between; padding: 8px 0;">
              <span style="color: #6b7280;">Overhead Rate:</span>
              <strong style="color: #374151;">${overheadRate}%</strong>
            </div>
            ` : ''}
          </div>
        </div>
      `;
    }
  }

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

  const subject = `Welcome to ${companyName} - ${roleDisplayName} Account Created`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="${baseStyles}">
  <div style="background: ${config.gradient}; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Welcome${['owner', 'corporate', 'office_admin'].includes(role) ? '' : ' to the Team'}, ${firstName}!</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0; font-size: 16px;">Your ${roleDisplayName} Account is Ready</p>
  </div>
  <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <p style="font-size: 16px; color: #374151; line-height: 1.6;">
      You have been added as a <strong style="color: ${config.textColor};">${roleDisplayName}</strong> at <strong>${companyName}</strong>.
    </p>
    <p style="font-size: 16px; color: #374151; line-height: 1.6;">
      ${description}
    </p>
    
    ${payStructureSection}
    
    <div style="margin: 30px 0; text-align: center;">
      ${passwordSetupLink ? `
        <a href="${passwordSetupLink}" style="${buttonStyle(config.gradient)}">Set Up Your Password</a>
      ` : `
        <p style="color: #6b7280; font-size: 14px;">Your administrator will provide your login credentials.</p>
      `}
    </div>
    
    ${settingsLink ? `
    <p style="font-size: 14px; color: #6b7280; text-align: center;">
      After setting your password, <a href="${settingsLink}" style="color: ${config.textColor};">complete your profile</a> to add your photo and details.
    </p>
    ` : ''}
    
    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
      <p style="font-size: 14px; color: #6b7280; margin: 0; text-align: center;">
        Questions? Contact your system administrator for assistance.
      </p>
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
    const { email } = requestData;

    console.log('Sending role-specific onboarding email to:', email, 'role:', requestData.role);

    const { subject, html } = getEmailTemplate(requestData);

    const emailResponse = await resend.emails.send({
      from: "PITCH CRM <onboarding@resend.dev>",
      to: [email],
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