import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: string;
  companyName: string;
  assignedTenantId?: string;
  title: string;
  payType?: 'hourly' | 'commission';
  hourlyRate?: number;
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile || !['master', 'corporate', 'office_admin', 'owner'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Only master, owner, corporate, and office admin can create users" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const {
      email,
      firstName,
      lastName,
      phone,
      role,
      companyName,
      assignedTenantId,
      title,
      payType,
      hourlyRate,
      payStructure
    }: CreateUserRequest = await req.json();

    const targetTenantId = assignedTenantId || profile.tenant_id;

    // SECURITY: Non-master users can ONLY create users in their own company
    if (profile.role !== 'master' && targetTenantId !== profile.tenant_id) {
      console.log('Security violation: Non-master user attempted to create user in different company', {
        callerRole: profile.role,
        callerTenantId: profile.tenant_id,
        attemptedTenantId: targetTenantId
      });
      return new Response(
        JSON.stringify({ 
          error: "You can only create users for your own company" 
        }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate required fields (password no longer required - using invite link)
    if (!email || !firstName || !lastName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, firstName, lastName" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate role - now includes 'owner'
    const validRoles = ['owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager'];
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: `Invalid role: "${role}". Must be one of: ${validRoles.join(', ')}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

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

    console.log('Creating user with invite link:', email, 'role:', role);

    // Create user WITHOUT password - use invite link flow
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false, // Will confirm via invite link
      user_metadata: {
        first_name: firstName,
        last_name: lastName
      }
    });

    if (createError) {
      console.error('Error creating user:', createError);
      if (createError.message.includes('already registered')) {
        throw new Error('A user with this email already exists');
      }
      throw createError;
    }

    if (!newUser.user) {
      throw new Error('User creation failed');
    }

    // Generate invite link for password setup
    const appUrl = Deno.env.get("APP_URL") || "https://pitch-1.lovable.app";
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: email,
      options: {
        redirectTo: `${appUrl}/reset-password`
      }
    });

    if (inviteError) {
      console.error('Error generating invite link:', inviteError);
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error('Failed to generate invite link');
    }

    const passwordSetupLink = inviteData?.properties?.action_link || '';
    console.log('User created, invite link generated');

    // Create profile data
    const profileData: Record<string, unknown> = {
      id: newUser.user.id,
      email,
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      role,
      company_name: companyName,
      title,
      is_active: true,
      tenant_id: targetTenantId,
      active_tenant_id: targetTenantId,
      pay_type: payType || 'commission',
      hourly_rate: payType === 'hourly' ? hourlyRate : null
    };

    // Add commission structure for sales reps
    if (payStructure && payType === 'commission' && ['sales_manager', 'regional_manager'].includes(role)) {
      profileData.overhead_rate = payStructure.overhead_rate;
      profileData.commission_structure = payStructure.commission_structure;
      profileData.commission_rate = payStructure.commission_rate;
      profileData.pay_structure_created_by = user.id;
      profileData.pay_structure_created_at = new Date().toISOString();
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }

    // Verify profile was created
    const { data: verifyProfile, error: verifyError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', newUser.user.id)
      .single();

    if (verifyError || !verifyProfile) {
      console.error('Profile verification failed:', verifyError);
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error('Profile creation could not be verified');
    }

    console.log('Profile created and verified');

    // Create user_roles entry
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
    }

    // Create user_company_access entry
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
    }

    // Send role-specific onboarding email
    try {
      await supabase.functions.invoke('send-user-invitation', {
        body: {
          email,
          firstName,
          lastName,
          phone,
          role,
          companyName,
          payType: payType || 'commission',
          hourlyRate: hourlyRate || null,
          commissionRate: payStructure?.commission_rate || null,
          overheadRate: payStructure?.overhead_rate || null,
          passwordSetupLink,
          settingsLink: `${appUrl}/settings`
        }
      });
      console.log('Onboarding email sent');
    } catch (emailError) {
      console.warn('Failed to send onboarding email:', emailError);
    }

    // Log audit trail
    try {
      await supabaseAdmin.from('audit_log').insert({
        tenant_id: profile.tenant_id,
        table_name: 'profiles',
        record_id: newUser.user.id,
        action: 'INSERT',
        new_values: profileData,
        changed_by: user.id
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
          role,
          pay_type: payType || 'commission'
        },
        message: 'User created successfully. An onboarding email has been sent with password setup instructions.'
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      }
    );
  } catch (error: unknown) {
    console.error("Error in admin-create-user function:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create user";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      }
    );
  }
};

serve(handler);