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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's profile and tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role, first_name, last_name')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { pipelineEntryId, newStatus, fromStatus } = await req.json();

    // Check if user has permission to make this move
    const isManager = ['manager', 'admin', 'master'].includes(profile.role);
    
    // Prevent non-managers from moving OUT of 'ready_for_approval' status
    if (fromStatus === 'ready_for_approval' && !isManager) {
      return new Response(JSON.stringify({ 
        error: 'Manager approval required',
        message: 'Only managers can move jobs from Ready for Approval status'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prevent non-managers from moving directly to 'project'
    if (newStatus === 'project' && !isManager) {
      return new Response(JSON.stringify({ 
        error: 'Manager approval required',
        message: 'Only managers can approve projects. Please move to "Hold (Mgr Review)" first.'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if moving from hold to project requires approval
    if (fromStatus === 'hold_mgr_review' && newStatus === 'project' && !isManager) {
      return new Response(JSON.stringify({ 
        error: 'Manager approval required',
        message: 'Only managers can approve projects from hold status.'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update pipeline entry status
    const { error: updateError } = await supabase
      .from('pipeline_entries')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', pipelineEntryId)
      .eq('tenant_id', profile.tenant_id);

    if (updateError) {
      console.error('Error updating pipeline entry:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update pipeline entry' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update contact's current_stage if contact exists
    const { data: pipelineEntry } = await supabase
      .from('pipeline_entries')
      .select('contact_id')
      .eq('id', pipelineEntryId)
      .single();

    if (pipelineEntry?.contact_id) {
      await supabase
        .from('contacts')
        .update({ 
          qualification_status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', pipelineEntry.contact_id)
        .eq('tenant_id', profile.tenant_id);
    }

    // Log the pipeline activity
    await supabase
      .from('pipeline_activities')
      .insert({
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        contact_id: pipelineEntry?.contact_id,
        activity_type: 'status_change',
        title: `Stage changed from ${fromStatus} to ${newStatus}`,
        description: `Pipeline entry moved from ${fromStatus} to ${newStatus} by ${profile.first_name} ${profile.last_name}`,
        status: 'completed'
      });

    // Auto-approve if moving to hold and user is a sales rep
    if (newStatus === 'hold_mgr_review' && !isManager) {
      // Create approval request
      await supabase
        .from('project_approval_requests')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          requested_by: user.id,
          notes: `Approval requested by ${profile.first_name} ${profile.last_name}`
        });
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: `Pipeline entry moved to ${newStatus}`,
      newStatus: newStatus,
      autoApprovalCreated: newStatus === 'hold_mgr_review' && !isManager
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in pipeline drag handler:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});