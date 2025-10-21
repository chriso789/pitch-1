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

    if (!profile || !['admin', 'master', 'manager'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Only admins and masters can create users" }),
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
      title,
      isDeveloper,
      payStructure
    }: CreateUserRequest = await req.json();

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
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

    console.log('Creating user with admin API:', email);

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

    // Create profile
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
      tenant_id: profile.tenant_id
    };

    // Add pay structure for sales reps/managers
    if (payStructure && ['admin', 'manager'].includes(role)) {
      profileData.overhead_rate = payStructure.overhead_rate;
      profileData.commission_structure = payStructure.commission_structure;
      profileData.commission_rate = payStructure.commission_rate;
      profileData.pay_structure_created_by = user.id;
      profileData.pay_structure_created_at = new Date().toISOString();
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert(profileData);

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Try to clean up the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }

    console.log('Profile created successfully');

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
