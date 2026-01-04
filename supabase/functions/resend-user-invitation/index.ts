import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { EMAIL_CONFIG, getFromEmail } from "../_shared/email-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ResendInvitationRequest {
  userId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { userId }: ResendInvitationRequest = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Resending invitation for user:", userId);

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("Profile not found:", profileError);
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get tenant info for branding
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .eq("id", profile.tenant_id)
      .single();

    // Get auth user to get email and check if they've signed in
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (authError || !authUser) {
      console.error("Auth user not found:", authError);
      return new Response(
        JSON.stringify({ error: "Auth user not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const email = authUser.email;
    if (!email) {
      return new Response(
        JSON.stringify({ error: "User has no email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("User exists, last_sign_in_at:", authUser.last_sign_in_at);

    // Since user already exists in auth.users, we MUST use 'recovery' type
    // 'invite' only works for creating new users
    const appUrl = Deno.env.get("APP_URL") || EMAIL_CONFIG.urls.app;
    
    console.log("Generating recovery link for existing user:", email);
    
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${appUrl}/reset-password?onboarding=true`,
      }
    });

    if (linkError) {
      console.error("Error generating recovery link:", linkError);
      return new Response(
        JSON.stringify({ error: "Failed to generate password setup link", details: linkError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const passwordSetupLink = linkData?.properties?.action_link || '';
    console.log("Recovery link generated successfully");

    // Send email via send-user-invitation function
    const emailPayload = {
      email: email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone,
      role: profile.role,
      companyName: tenant?.name || "PITCH CRM",
      payType: profile.pay_type,
      hourlyRate: profile.hourly_rate,
      commissionRate: profile.commission_rate,
      overheadRate: profile.overhead_rate,
      passwordSetupLink,
      settingsLink: `${appUrl}/settings`,
      companyLogo: tenant?.logo_url,
      companyPrimaryColor: tenant?.primary_color,
      companySecondaryColor: tenant?.secondary_color,
      ownerName: tenant?.owner_name,
      ownerTitle: "Owner",
      ownerEmail: tenant?.owner_email,
      isResend: true, // Flag to indicate this is a resend
    };

    console.log("Sending invitation email to:", email);
    
    const { data: emailResult, error: emailError } = await supabaseAdmin.functions.invoke(
      'send-user-invitation',
      { body: emailPayload }
    );

    if (emailError) {
      console.error("Error sending email:", emailError);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: emailError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Invitation email sent successfully:", emailResult);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Password setup email sent to ${email}`,
        emailResult 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in resend-user-invitation:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
