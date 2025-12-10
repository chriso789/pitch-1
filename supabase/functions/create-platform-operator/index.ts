import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateOperatorRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  permissions?: {
    view_all_companies: boolean;
    manage_features: boolean;
    manage_users: boolean;
    delete_companies: boolean;
  };
  notes?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get caller's auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Verify caller is master role
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: callerUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !callerUser) {
      throw new Error("Unauthorized");
    }

    // Check if caller has master role
    const { data: callerRoles, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);

    if (roleError) throw roleError;
    
    const isMaster = callerRoles?.some(r => r.role === "master");
    if (!isMaster) {
      throw new Error("Only master users can create platform operators");
    }

    const body: CreateOperatorRequest = await req.json();
    const { email, password, first_name, last_name, permissions, notes } = body;

    if (!email || !password || !first_name || !last_name) {
      throw new Error("Missing required fields: email, password, first_name, last_name");
    }

    // Get caller's profile for tenant assignment
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", callerUser.id)
      .single();

    // Create the user account
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name,
        last_name
      }
    });

    if (createError) throw createError;
    if (!newUser.user) throw new Error("Failed to create user");

    const userId = newUser.user.id;

    // Create profile with platform operator flags
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      email,
      first_name,
      last_name,
      role: "corporate",
      tenant_id: callerProfile?.tenant_id,
      active_tenant_id: callerProfile?.tenant_id,
      can_manage_all_companies: true,
      created_by_master: callerUser.id,
      is_suspended: false
    });

    if (profileError) throw profileError;

    // Create user role
    const { error: roleInsertError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role: "corporate"
    });

    if (roleInsertError) throw roleInsertError;

    // Create platform operator record
    const defaultPermissions = permissions || {
      view_all_companies: true,
      manage_features: true,
      manage_users: false,
      delete_companies: false
    };

    const { error: operatorError } = await supabaseAdmin.from("platform_operators").insert({
      user_id: userId,
      created_by_master: callerUser.id,
      granted_permissions: defaultPermissions,
      is_active: true,
      notes: notes || null
    });

    if (operatorError) throw operatorError;

    // Grant access to ALL companies
    const { data: allTenants } = await supabaseAdmin
      .from("tenants")
      .select("id");

    if (allTenants && allTenants.length > 0) {
      const accessRecords = allTenants.map(tenant => ({
        user_id: userId,
        tenant_id: tenant.id,
        access_level: "full",
        is_active: true,
        granted_by: callerUser.id
      }));

      const { error: accessError } = await supabaseAdmin
        .from("user_company_access")
        .insert(accessRecords);

      if (accessError) {
        console.error("Error granting company access:", accessError);
      }
    }

    // Log the action
    await supabaseAdmin.from("audit_log").insert({
      table_name: "platform_operators",
      record_id: userId,
      action: "INSERT",
      new_values: { 
        email, 
        first_name, 
        last_name, 
        role: "corporate",
        permissions: defaultPermissions 
      },
      changed_by: callerUser.id
    });

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email,
        message: `Platform operator ${first_name} ${last_name} created successfully with access to ${allTenants?.length || 0} companies`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error creating platform operator:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
