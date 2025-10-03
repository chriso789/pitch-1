import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UpdatePasswordRequest {
  userId: string;
  newPassword: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase Admin Client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get the authorization header to verify the requesting user
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Initialize regular client to verify the requesting user
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    // Verify the requesting user
    const { data: { user: requestingUser }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !requestingUser) {
      throw new Error("Invalid authentication");
    }

    // Get the requesting user's profile
    const { data: requestingProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", requestingUser.id)
      .single();

    if (profileError || !requestingProfile) {
      throw new Error("Could not find requesting user profile");
    }

    const { userId, newPassword }: UpdatePasswordRequest = await req.json();

    if (!userId || !newPassword) {
      throw new Error("Missing userId or newPassword");
    }

    if (newPassword.length < 6) {
      throw new Error("Password must be at least 6 characters long");
    }

    // Get the target user's profile
    const { data: targetProfile, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (targetError || !targetProfile) {
      throw new Error("Could not find target user profile");
    }

    // Define role hierarchy
    const roleHierarchy: Record<string, number> = {
      'master': 5,
      'admin': 4,
      'manager': 3,
      'sales_rep': 2,
      'technician': 2,
      'user': 1
    };

    const requestingRoleLevel = roleHierarchy[requestingProfile.role] || 0;
    const targetRoleLevel = roleHierarchy[targetProfile.role] || 0;

    // Check permissions - allow if:
    // 1. User is updating their own password
    // 2. User is master role (can update anyone)
    // 3. User is admin role (can update manager, sales_rep, technician, user)
    // 4. User is manager role (can update sales_rep, technician, user)
    // 5. User is Chris O'Brien variation with manager+ role updating another Chris O'Brien variation
    const canUpdate = (
      requestingUser.id === userId || // Own password
      requestingProfile.role === 'master' || // Master can update anyone
      (requestingProfile.role === 'admin' && targetRoleLevel < 4) || // Admin can update below admin
      (requestingProfile.role === 'manager' && targetRoleLevel <= 2) || // Manager can update reps/techs
      (
        // Chris O'Brien variations with manager+ role (special case)
        (
          requestingProfile.first_name?.toLowerCase().includes('chris') && 
          requestingProfile.last_name?.toLowerCase().includes('brien') &&
          ['manager', 'admin', 'master'].includes(requestingProfile.role)
        ) && (
          targetProfile.first_name?.toLowerCase().includes('chris') && 
          targetProfile.last_name?.toLowerCase().includes('brien') &&
          ['manager', 'admin', 'master'].includes(targetProfile.role)
        )
      )
    );

    if (!canUpdate) {
      throw new Error("Insufficient permissions to update this user's password");
    }

    // Update the user's password using admin client
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError) {
      throw updateError;
    }

    // Log the password change for security audit
    await supabaseAdmin
      .from("audit_log")
      .insert({
        tenant_id: requestingProfile.tenant_id,
        table_name: "auth.users",
        record_id: userId,
        action: "PASSWORD_UPDATE",
        old_values: null,
        new_values: { updated_by: requestingUser.id, method: "admin_direct" },
        changed_by: requestingUser.id
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password updated successfully" 
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );

  } catch (error: any) {
    console.error("Error in admin-update-password function:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "An unexpected error occurred" 
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
};

serve(handler);