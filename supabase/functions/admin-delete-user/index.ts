import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Get the current user from JWT
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Get current user's profile
    const { data: currentUserProfile, error: profileError } = await supabase
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', user.id)
      .single();

    if (profileError || !currentUserProfile) {
      throw new Error('User profile not found');
    }

    // Parse request body
    const { userId } = await req.json();

    if (!userId) {
      throw new Error('User ID is required');
    }

    // Get the target user's profile
    const { data: targetUser, error: targetError } = await supabase
      .from('profiles')
      .select('role, tenant_id, first_name, last_name, email')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      throw new Error('Target user not found');
    }

    // Verify same tenant
    if (targetUser.tenant_id !== currentUserProfile.tenant_id) {
      throw new Error('Cannot delete users from different tenant');
    }

    // Verify permissions
    const isMaster = currentUserProfile.role === 'master';
    const isManager = currentUserProfile.role === 'manager';
    const isSalesRep = targetUser.role === 'admin'; // 'admin' role is sales rep

    // Master can delete anyone, Manager can only delete sales reps
    if (!isMaster && !(isManager && isSalesRep)) {
      throw new Error('Insufficient permissions to delete this user');
    }

    // Prevent self-deletion
    if (userId === user.id) {
      throw new Error('Cannot delete your own account');
    }

    // Soft delete: deactivate the user instead of hard delete
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        is_active: false,
        deleted_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }

    // Log the deletion in audit log
    await supabase.from('audit_log').insert({
      tenant_id: currentUserProfile.tenant_id,
      table_name: 'profiles',
      record_id: userId,
      action: 'DELETE',
      changed_by: user.id,
      old_values: {
        first_name: targetUser.first_name,
        last_name: targetUser.last_name,
        email: targetUser.email,
        role: targetUser.role
      },
      new_values: {
        is_active: false,
        deleted_at: new Date().toISOString()
      }
    });

    console.log(`User ${userId} deleted by ${user.id}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'User deleted successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in admin-delete-user:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
