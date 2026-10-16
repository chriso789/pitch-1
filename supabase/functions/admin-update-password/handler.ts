import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pitch-tenant",
};

interface UpdatePasswordRequest {
  userId: string;
  newPassword: string;
}

// Role hierarchy for password administration. Roles are read ONLY from the
// protected user_roles table (via has_role), never from profiles.
const ROLE_LEVEL: Record<string, number> = {
  master: 6,
  owner: 5,
  corporate: 4,
  office_admin: 3,
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json(401, { error: "Not signed in" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const { data: { user: requestingUser }, error: authError } =
      await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !requestingUser) {
      return json(401, { error: "Not signed in" });
    }

    let body: UpdatePasswordRequest;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid request" });
    }
    const { userId, newPassword } = body;
    if (!userId || !newPassword || typeof newPassword !== "string") {
      return json(400, { error: "Invalid request" });
    }
    if (newPassword.length < 8) {
      return json(400, { error: "Password must be at least 8 characters long" });
    }

    // Resolve the target user's home tenant.
    const { data: targetProfile, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", userId)
      .single();
    if (targetError || !targetProfile) {
      return json(404, { error: "User not found" });
    }

    // Resolve the caller's roles in the TARGET user's company from user_roles.
    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .eq("tenant_id", targetProfile.tenant_id);
    if (roleError) {
      console.error("admin-update-password role lookup failed:", roleError.message);
      return json(500, { error: "Could not verify permissions" });
    }
    const callerLevel = Math.max(
      0,
      ...(roleRows ?? []).map((r) => ROLE_LEVEL[r.role as string] ?? 0),
    );

    // Target's own level (for hierarchy comparison).
    const { data: targetRoleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", targetProfile.tenant_id);
    const targetLevel = Math.max(
      0,
      ...(targetRoleRows ?? []).map((r) => ROLE_LEVEL[r.role as string] ?? 0),
    );

    // Allowed if: updating own password, or caller holds an admin role in the
    // target's company strictly above the target's level. Master (platform)
    // may update anyone. No identity/name-based exceptions.
    const isSelf = requestingUser.id === userId;
    const isMaster = (roleRows ?? []).some((r) => r.role === "master");
    const canUpdate =
      isSelf || isMaster || (callerLevel >= 3 && callerLevel > targetLevel);

    if (!canUpdate) {
      return json(403, { error: "Not allowed" });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword },
    );
    if (updateError) {
      console.error("admin-update-password update failed:", updateError.message);
      return json(400, { error: "Password could not be updated" });
    }

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: targetProfile.tenant_id,
      table_name: "auth.users",
      record_id: userId,
      action: "PASSWORD_UPDATE",
      old_values: null,
      new_values: { updated_by: requestingUser.id, method: "admin_direct" },
      changed_by: requestingUser.id,
    });

    return json(200, { success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error(
      "Error in admin-update-password function:",
      error instanceof Error ? error.message : String(error),
    );
    return json(500, { error: "An unexpected error occurred" });
  }
};

export const handle = handler;
