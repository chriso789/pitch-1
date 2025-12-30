import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

    // Get user from auth header (optional - can be admin only)
    const authHeader = req.headers.get("Authorization");
    let requestingUser = null;
    
    if (authHeader) {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseClient.auth.getUser();
      requestingUser = user;
    }

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

    // Get auth user to get email
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

    console.log("Generating new invite link for:", email);

    // Generate new invite link
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-1.lovable.app";
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: email,
      options: {
        redirectTo: `${appUrl}/auth/callback`,
      }
    });

    if (inviteError) {
      console.error("Error generating invite link:", inviteError);
      return new Response(
        JSON.stringify({ error: "Failed to generate invite link", details: inviteError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const passwordSetupLink = inviteData?.properties?.action_link || '';
    console.log("Invite link generated successfully");

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
        message: `Invitation email sent to ${email}`,
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
