import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://pitch-1.lovable.app";

/**
 * Convert Supabase action_link to direct app setup link
 * This bypasses Supabase redirect configuration entirely.
 */
function buildDirectSetupLink(actionLink: string): string {
  try {
    const url = new URL(actionLink);
    const tokenHash = url.searchParams.get('token');
    const type = url.searchParams.get('type') || 'invite';
    
    if (!tokenHash) {
      console.warn('[buildDirectSetupLink] No token found in action_link, returning original');
      return actionLink;
    }
    
    const directLink = `${APP_URL}/setup-account?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`;
    console.log('[buildDirectSetupLink] Converted to direct link');
    return directLink;
  } catch (err) {
    console.error('[buildDirectSetupLink] Failed to parse action_link:', err);
    return actionLink;
  }
}

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
  locationIds?: string[];
  skipInvitationEmail?: boolean; // For owners who get company onboarding email instead
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

    // Get caller's profile for tenant_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    // SECURITY: Check role from user_roles table using service role client
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

    const { data: userRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const callerRole = userRole?.role;
    const allowedRoles = ['master', 'corporate', 'office_admin', 'owner'];

    if (!callerRole || !allowedRoles.includes(callerRole)) {
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
      payStructure,
      locationIds,
      skipInvitationEmail
    }: CreateUserRequest = await req.json();

    const targetTenantId = assignedTenantId || profile?.tenant_id;

    // SECURITY: Non-master users can ONLY create users in their own company
    if (callerRole !== 'master' && targetTenantId !== profile?.tenant_id) {
      console.log('Security violation: Non-master user attempted to create user in different company', {
        callerRole,
        callerTenantId: profile?.tenant_id,
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

    // supabaseAdmin already created above for role check

    console.log('Creating user with invite link:', email, 'role:', role);

    // Check if user already exists in auth but is orphaned (no profile)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    let newUser: { user: typeof existingAuthUser } | null = null;
    let createError: Error | null = null;
    
    if (existingAuthUser) {
      // Check if profile exists for this auth user
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', existingAuthUser.id)
        .maybeSingle();
      
      if (!existingProfile) {
        // Orphaned auth user - delete and recreate
        console.log('Found orphaned auth user, deleting:', existingAuthUser.id);
        await supabaseAdmin.auth.admin.deleteUser(existingAuthUser.id);
        
        // Now create fresh
        const result = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: {
            first_name: firstName,
            last_name: lastName
          }
        });
        newUser = result.data;
        createError = result.error;
      } else {
        // User exists with profile - return error
        return new Response(
          JSON.stringify({ error: "A user with this email already exists" }),
          { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    } else {
      // Create new user
      const result = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: {
          first_name: firstName,
          last_name: lastName
        }
      });
      newUser = result.data;
      createError = result.error;
    }

    if (createError) {
      console.error('Error creating user:', createError);
      throw createError;
    }

    if (!newUser.user) {
      throw new Error('User creation failed');
    }

    // Generate invite link for password setup
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: email,
    });

    if (inviteError) {
      console.error('Error generating invite link:', inviteError);
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error('Failed to generate invite link');
    }

    // Convert to direct link that bypasses Supabase redirect config
    const passwordSetupLink = inviteData?.properties?.action_link 
      ? buildDirectSetupLink(inviteData.properties.action_link)
      : '';
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

    // Create user_location_assignments entries
    if (locationIds && locationIds.length > 0) {
      const locationAssignments = locationIds.map(locationId => ({
        tenant_id: targetTenantId,
        user_id: newUser.user.id,
        location_id: locationId,
        assigned_by: user.id,
        is_active: true
      }));

      const { error: locationError } = await supabaseAdmin
        .from('user_location_assignments')
        .insert(locationAssignments);

      if (locationError) {
        console.error('Error creating location assignments:', locationError);
      } else {
        console.log(`Created ${locationIds.length} location assignment(s) for user`);
      }
    }

    // Fetch company branding details for the email
    const { data: companyData } = await supabaseAdmin
      .from('tenants')
      .select('name, logo_url, primary_color, secondary_color, owner_name, owner_email')
      .eq('id', targetTenantId)
      .single();

    // Fetch owner profile for personalized welcome message
    const { data: ownerData } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name, avatar_url, title, email')
      .eq('tenant_id', targetTenantId)
      .eq('role', 'owner')
      .maybeSingle();

    console.log('Company data for email:', companyData?.name, 'Owner:', ownerData?.first_name);

    // Send role-specific onboarding email with company branding
    // SKIP for owners - they get the comprehensive company onboarding email instead
    if (skipInvitationEmail || role === 'owner') {
      console.log(`Skipping user invitation email for ${role} - will receive company onboarding email`);
    } else {
      try {
        await supabase.functions.invoke('send-user-invitation', {
          body: {
            email,
            firstName,
            lastName,
            phone,
            role,
            companyName: companyData?.name || companyName,
            payType: payType || 'commission',
            hourlyRate: hourlyRate || null,
            commissionRate: payStructure?.commission_rate || null,
            overheadRate: payStructure?.overhead_rate || null,
            passwordSetupLink,
            settingsLink: `${APP_URL}/settings`,
            loginUrl: `${APP_URL}/login`,
            // Company branding
            companyLogo: companyData?.logo_url || null,
            companyPrimaryColor: companyData?.primary_color || '#1e40af',
            companySecondaryColor: companyData?.secondary_color || '#3b82f6',
            // Owner personal touch
            ownerName: ownerData?.first_name 
              ? `${ownerData.first_name} ${ownerData.last_name || ''}`.trim()
              : companyData?.owner_name || null,
            ownerHeadshot: ownerData?.avatar_url || null,
            ownerTitle: ownerData?.title || 'Owner',
            ownerEmail: ownerData?.email || companyData?.owner_email || null
          }
        });
        console.log('Onboarding email sent with company branding');
      } catch (emailError) {
        console.warn('Failed to send onboarding email:', emailError);
      }
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