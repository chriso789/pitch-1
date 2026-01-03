import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateUserRequest {
  email: string;
  first_name: string;
  last_name?: string;
  tenant_id: string;
  phone?: string;
  role?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { email, first_name, last_name, tenant_id, phone, role }: CreateUserRequest = await req.json();

    console.log("[create-company-user] Creating user for:", email, "tenant:", tenant_id);

    if (!email || !tenant_id) {
      return new Response(
        JSON.stringify({ error: "email and tenant_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    let userId: string;

    if (existingUser) {
      console.log("[create-company-user] User already exists:", existingUser.id);
      userId = existingUser.id;
    } else {
      // Create user in Supabase Auth with a random password (they'll reset it)
      const tempPassword = crypto.randomUUID() + crypto.randomUUID();
      
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          first_name,
          last_name: last_name || "",
          full_name: `${first_name} ${last_name || ""}`.trim(),
        },
      });

      if (createError) {
        console.error("[create-company-user] Error creating user:", createError);
        return new Response(
          JSON.stringify({ error: createError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = newUser.user.id;
      console.log("[create-company-user] Created new user:", userId);
    }

    // Create or update profile
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: userId,
        tenant_id,
        email,
        first_name,
        last_name: last_name || "",
        phone: phone || null,
        role: role || "owner",
        is_active: true,
        active_tenant_id: tenant_id,
      }, {
        onConflict: "id",
      });

    if (profileError) {
      console.error("[create-company-user] Error creating profile:", profileError);
      // Don't fail - profile might already exist
    } else {
      console.log("[create-company-user] Profile created/updated for:", userId);
    }

    // Add user to user_company_access for their company
    const { error: accessError } = await supabase
      .from("user_company_access")
      .upsert({
        user_id: userId,
        tenant_id,
        access_level: "full",
        is_active: true,
        granted_by: userId,
      }, {
        onConflict: "user_id,tenant_id",
      });

    if (accessError) {
      console.error("[create-company-user] Error granting company access:", accessError);
    } else {
      console.log("[create-company-user] Company access granted for:", userId, "to tenant:", tenant_id);
    }

    // Generate password reset link
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-crm.lovable.app";
    const resetRedirectUrl = `${appUrl}/reset-password`;

    const { data: resetData, error: resetError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: resetRedirectUrl,
      },
    });

    if (resetError) {
      console.error("[create-company-user] Error generating reset link:", resetError);
      // Don't fail - we can still return the user ID
    }

    const resetLink = resetData?.properties?.action_link || null;
    console.log("[create-company-user] Generated reset link for:", email);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        reset_link: resetLink,
        message: existingUser ? "User already existed, profile updated" : "User created successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[create-company-user] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
