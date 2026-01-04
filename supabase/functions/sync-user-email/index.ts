import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncEmailRequest {
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

    const { userId }: SyncEmailRequest = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Syncing email for user:", userId);

    // Get email from profiles table (this is the source of truth after UI updates)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("Profile not found:", profileError);
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile.email) {
      console.log("No email in profile, nothing to sync");
      return new Response(
        JSON.stringify({ success: true, message: "No email to sync" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Profile email:", profile.email);

    // Get current auth user email to check if sync is needed
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (authError || !authUser) {
      console.error("Auth user not found:", authError);
      return new Response(
        JSON.stringify({ error: "Auth user not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Current auth email:", authUser.email);

    // Check if emails are already in sync
    if (authUser.email === profile.email) {
      console.log("Emails already in sync");
      return new Response(
        JSON.stringify({ success: true, message: "Emails already in sync" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update auth.users email to match profiles email
    console.log("Updating auth email from", authUser.email, "to", profile.email);
    
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: profile.email,
      email_confirm: true // Auto-confirm the new email
    });

    if (updateError) {
      console.error("Error updating auth email:", updateError);
      
      // Check if error is due to email already taken
      if (updateError.message?.includes("already been registered") || updateError.message?.includes("duplicate")) {
        return new Response(
          JSON.stringify({ 
            error: "Email already in use by another account",
            details: updateError.message 
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to update auth email", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Successfully synced email to:", profile.email);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Email synced from ${authUser.email} to ${profile.email}`,
        oldEmail: authUser.email,
        newEmail: profile.email
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in sync-user-email:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
