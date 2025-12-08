import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  companyName: string;
  assignedTenantId?: string; // Optional: assign user to a specific company
  title: string;
  isDeveloper: boolean;
  payStructure?: {
    overhead_rate: number;
    commission_structure: 'profit_split' | 'sales_percentage';
    commission_rate: number;
  };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Initialize regular client to verify the calling user
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Check if user is admin or master
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile || !['master', 'corporate', 'office_admin'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Only master, corporate, and office admin can create users" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const {
      email,
      password,
      firstName,
      lastName,
      role,
      companyName,
      assignedTenantId,
      title,
      isDeveloper,
      payStructure
    }: CreateUserRequest = await req.json();

    // Determine which tenant to assign user to
    const targetTenantId = assignedTenantId || profile.tenant_id;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate role against allowed enum values
    const validRoles = ['master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager'];
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: `Invalid role: "${role}". Must be one of: ${validRoles.join(', ')}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Initialize admin client
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

    console.log('Creating user with admin API:', email, 'with role:', role, '(validated against:', validRoles.join(', '), ')');

    // Double-check the role is correct before proceeding
    if (role === 'admin' || !validRoles.includes(role)) {
      console.error('CRITICAL: Invalid role detected after validation:', role);
      return new Response(
        JSON.stringify({ error: `Invalid role detected: "${role}". This should not happen.` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create user with admin API (bypasses rate limits)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        first_name: firstName,
        last_name: lastName
      }
    });

    if (createError) {
      console.error('Error creating user:', createError);
      
      // Handle specific errors
      if (createError.message.includes('already registered')) {
        throw new Error('A user with this email already exists');
      }
      
      throw createError;
    }

    if (!newUser.user) {
      throw new Error('User creation failed');
    }

    console.log('User created successfully, creating profile:', newUser.user.id);

    // Create profile data - explicitly log to verify role value
    console.log('Building profileData with role:', role, 'type:', typeof role);
    const profileData: any = {
      id: newUser.user.id,
      email,
      first_name: firstName,
      last_name: lastName,
      role,
      company_name: companyName,
      title,
      is_developer: isDeveloper,
      is_active: true,
      tenant_id: targetTenantId,
      active_tenant_id: targetTenantId
    };
    console.log('ProfileData role value:', profileData.role, 'Target tenant:', targetTenantId);

    // Add pay structure for sales reps/managers
    if (payStructure && ['sales_manager', 'regional_manager'].includes(role)) {
      profileData.overhead_rate = payStructure.overhead_rate;
      profileData.commission_structure = payStructure.commission_structure;
      profileData.commission_rate = payStructure.commission_rate;
      profileData.pay_structure_created_by = user.id;
      profileData.pay_structure_created_at = new Date().toISOString();
    }

    // Use upsert since trigger may have created a profile already
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Try to clean up the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }

    console.log('Profile created successfully');

    // Create user_roles entry for secure role-based access
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: newUser.user.id,
        tenant_id: targetTenantId,
        role,
        created_by: user.id
      });

    if (roleError) {
      console.error('Error creating user role:', roleError);
      console.warn('User created but role assignment failed - user may need manual role assignment');
    } else {
      console.log('User role created successfully');
    }

    // Create user_company_access entry for multi-tenant access control
    const { error: accessError } = await supabaseAdmin
      .from('user_company_access')
      .insert({
        user_id: newUser.user.id,
        tenant_id: targetTenantId,
        granted_by: user.id,
        access_level: 'full',
        is_active: true
      });

    if (accessError) {
      console.error('Error creating user company access:', accessError);
      console.warn('User created but company access record failed');
    } else {
      console.log('User company access created successfully');
    }

    // Send welcome email (without password)
    try {
      await supabase.functions.invoke('send-user-invitation', {
        body: {
          email,
          firstName,
          lastName,
          role,
          companyName
        }
      });
      console.log('Welcome email sent');
    } catch (emailError) {
      console.warn('Failed to send welcome email:', emailError);
      // Don't fail the entire request if email fails
    }

    // Log audit trail
    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: 'INSERT',
        table_name: 'profiles',
        record_id: newUser.user.id,
        new_data: profileData,
        metadata: {
          action_type: 'user_creation',
          created_by_admin: true
        }
      });
    } catch (auditError) {
      console.warn('Failed to log audit trail:', auditError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          role
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      }
    );
  } catch (error: any) {
    console.error("Error in admin-create-user function:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to create user"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      }
    );
  }
};

serve(handler);
