import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ValidateRequest {
  token: string;
  password: string;
}

Deno.Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { token, password }: ValidateRequest = await req.json();

    if (!token || !password) {
      return new Response(
        JSON.stringify({ error: "token and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up token
    const { data: tokenRecord, error: tokenError } = await supabaseAdmin
      .from('setup_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (tokenError || !tokenRecord) {
      console.error('[validate-setup-token] Token not found:', tokenError);
      return new Response(
        JSON.stringify({ error: "Invalid or expired setup link. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already used
    if (tokenRecord.used_at) {
      return new Response(
        JSON.stringify({ error: "This setup link has already been used. Please log in or request a new link." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiry
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "This setup link has expired. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = tokenRecord.user_id;

    // Set the user's password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password }
    );

    if (updateError) {
      console.error('[validate-setup-token] Password update failed:', updateError);
      return new Response(
        JSON.stringify({ error: "Failed to set password. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark token as used
    await supabaseAdmin
      .from('setup_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRecord.id);

    // Get user details for the response
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (userError || !user) {
      console.error('[validate-setup-token] User fetch failed:', userError);
      return new Response(
        JSON.stringify({ error: "Password set but failed to retrieve user details." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a magic link so the client can sign in automatically
    const { data: magicData, error: magicError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email!,
    });

    // Update password_set_at in profile
    await supabaseAdmin
      .from('profiles')
      .update({ password_set_at: new Date().toISOString() })
      .eq('id', userId);

    console.log('[validate-setup-token] Password set successfully for:', user.email);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email: user.email,
        // Return the magic link properties so client can complete sign-in
        magic_link: magicData?.properties?.action_link || null,
        hashed_token: magicData?.properties?.hashed_token || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('[validate-setup-token] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
