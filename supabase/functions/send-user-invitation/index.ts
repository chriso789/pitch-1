import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface UserInvitationRequest {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  companyName: string;
  temporaryPassword: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      email, 
      firstName, 
      lastName, 
      role, 
      companyName, 
      temporaryPassword 
    }: UserInvitationRequest = await req.json();

    console.log('Sending invitation email to:', email);

    const emailResponse = await resend.emails.send({
      from: "Roofing CRM <onboarding@resend.dev>",
      to: [email],
      subject: "Welcome to Roofing CRM - Your Account Has Been Created",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #2563eb; margin-bottom: 20px;">Welcome to Roofing CRM!</h1>
          
          <p style="font-size: 16px; line-height: 1.5; margin-bottom: 15px;">
            Hello ${firstName} ${lastName},
          </p>
          
          <p style="font-size: 16px; line-height: 1.5; margin-bottom: 15px;">
            Your account has been created for ${companyName} with the role of <strong>${role}</strong>.
          </p>
          
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1f2937;">Your Login Credentials:</h3>
            <p style="margin-bottom: 10px;"><strong>Email:</strong> ${email}</p>
            <p style="margin-bottom: 10px;"><strong>Temporary Password:</strong> ${temporaryPassword}</p>
            <p style="margin-bottom: 0; color: #dc2626; font-weight: bold;">This password is temporary and must be changed on first login.</p>
          </div>
          
          <div style="background-color: #fef3cd; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #92400e;">
              <strong>Next Steps:</strong>
            </p>
            <ol style="margin: 10px 0; color: #92400e;">
              <li>Go to the login page</li>
              <li>Click "Set Password" tab</li>
              <li>Enter your email and temporary password</li>
              <li>Create a strong new password</li>
              <li>You'll then be logged in automatically</li>
            </ol>
          </div>
          
          <p style="font-size: 16px; line-height: 1.5; margin-bottom: 15px;">
            You can access the system using the login page. Make sure to change your password immediately for security.
          </p>
          
          <p style="font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
            If you have any questions or need assistance, please contact your system administrator.
          </p>
          
          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              Best regards,<br>
              The Roofing CRM Team
            </p>
          </div>
        </div>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-user-invitation function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);