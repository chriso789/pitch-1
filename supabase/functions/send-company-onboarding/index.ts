import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OnboardingEmailRequest {
  tenant_id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
}

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

    // Generate unique token
    const token = crypto.randomUUID() + '-' + Date.now().toString(36);
    
    // Token expires in 48 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

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

    // Send email via Resend
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to PITCH CRM</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Your construction business command center</p>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${first_name}! 👋</h2>
            
            <p>Your account for <strong>${company_name}</strong> has been created. Let's get you set up!</p>
            
            <p>Click the button below to:</p>
            <ul style="color: #4b5563;">
              <li>✅ Set your secure password</li>
              <li>✅ Complete your profile</li>
              <li>✅ Upload your company logo</li>
              <li>✅ Set up Smart Docs</li>
              <li>✅ Take a quick feature tour</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${onboardingUrl}" style="display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Complete Your Setup →
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px;">
              This link expires in 48 hours. If you didn't request this, please ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              © ${new Date().getFullYear()} PITCH CRM. All rights reserved.
            </p>
          </div>
        </body>
        </html>
      `;

      const emailResult = await resend.emails.send({
        from: "PITCH CRM <onboarding@resend.dev>",
        to: [email],
        subject: `Welcome to PITCH CRM - Complete Your ${company_name} Setup`,
        html: emailHtml,
      });

      console.log('Onboarding email sent:', emailResult);
    } else {
      console.warn('RESEND_API_KEY not configured, skipping email');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        token,
        onboarding_url: onboardingUrl,
        expires_at: expiresAt.toISOString()
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
