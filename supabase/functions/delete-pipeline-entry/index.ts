import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

console.log("Delete pipeline entry function started");

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const authorization = req.headers.get('Authorization');
    if (!authorization) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Get the user from the auth token
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authorization.replace('Bearer ', '')
    );

    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Get user profile and tenant
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      console.error('Profile error:', profileError);
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check if user has permission to delete jobs (managers and admins only)
    const allowedRoles = ['admin', 'manager', 'master'];
    if (!allowedRoles.includes(profile.role)) {
      return new Response(
        JSON.stringify({ 
          error: 'Insufficient permissions', 
          message: 'Only managers and administrators can delete jobs' 
        }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { entryId } = await req.json();

    if (!entryId) {
      return new Response(
        JSON.stringify({ error: 'Job ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Get the job to verify it exists and belongs to the tenant
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, contact_id, tenant_id, status, name')
      .eq('id', entryId)
      .eq('tenant_id', profile.tenant_id)
      .single();

    if (jobError || !job) {
      console.error('Job fetch error:', jobError);
      return new Response(
        JSON.stringify({ error: 'Job not found or access denied' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Soft delete the job (set is_deleted flag instead of permanent delete)
    const { error: deleteError } = await supabase
      .from('jobs')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id
      })
      .eq('id', entryId)
      .eq('tenant_id', profile.tenant_id);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete job' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Log the deletion activity
    const { error: logError } = await supabase
      .from('communication_history')
      .insert({
        tenant_id: profile.tenant_id,
        contact_id: job.contact_id,
        communication_type: 'system',
        direction: 'internal',
        content: `Job "${job.name}" (${job.status}) was deleted by ${user.email}`,
        rep_id: user.id,
        metadata: {
          action: 'job_deleted',
          job_id: entryId,
          status: job.status,
          deleted_by: user.id,
          deleted_at: new Date().toISOString()
        }
      });

    if (logError) {
      console.error('Failed to log deletion activity:', logError);
      // Don't fail the request if logging fails
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Job has been deleted successfully`,
        entryId: entryId
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});