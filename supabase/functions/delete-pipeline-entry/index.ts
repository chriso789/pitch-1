import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from request
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's profile and role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id, role, first_name, last_name')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      console.error('Profile error:', profileError);
      return new Response(JSON.stringify({ error: 'No tenant found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user has manager permissions (manager, admin, or master)
    const isManager = ['manager', 'admin', 'master'].includes(profile.role);
    
    if (!isManager) {
      console.warn(`Delete attempt by non-manager: ${user.id} (role: ${profile.role})`);
      return new Response(JSON.stringify({ 
        error: 'Insufficient permissions',
        message: 'Only managers can delete jobs. Contact your administrator.'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { entryId } = await req.json();

    if (!entryId) {
      return new Response(JSON.stringify({ error: 'Entry ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Soft deleting pipeline entry: ${entryId} by user: ${user.id} (${profile.first_name} ${profile.last_name})`);

    // Verify the entry exists and belongs to the same tenant
    const { data: existingEntry, error: checkError } = await supabase
      .from('pipeline_entries')
      .select('id, tenant_id, contact_id, status, clj_formatted_number')
      .eq('id', entryId)
      .eq('tenant_id', profile.tenant_id)
      .single();

    if (checkError || !existingEntry) {
      console.error('Entry not found or access denied:', checkError);
      return new Response(JSON.stringify({ 
        error: 'Pipeline entry not found or access denied' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Soft delete the pipeline entry
    const { error: deleteError } = await supabase
      .from('pipeline_entries')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', entryId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return new Response(JSON.stringify({ 
        error: 'Failed to delete pipeline entry',
        message: deleteError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log the deletion activity
    await supabase
      .from('pipeline_activities')
      .insert({
        pipeline_entry_id: entryId,
        activity_type: 'status_change',
        description: `Job deleted by ${profile.first_name} ${profile.last_name}`,
        performed_by: user.id,
        tenant_id: profile.tenant_id,
        metadata: {
          action: 'soft_delete',
          previous_status: existingEntry.status,
          contact_id: existingEntry.contact_id,
          job_number: existingEntry.clj_formatted_number
        }
      });

    console.log(`Successfully deleted pipeline entry: ${entryId}`);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Pipeline entry deleted successfully',
      entryId: entryId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
