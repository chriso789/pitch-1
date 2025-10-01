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

    const { pipelineEntryId, newStatus, fromStatus, reason } = await req.json();

    // Get pipeline entry details
    const { data: pipelineEntry } = await supabase
      .from('pipeline_entries')
      .select('*, status_entered_at')
      .eq('id', pipelineEntryId)
      .single();

    if (!pipelineEntry) {
      return new Response(JSON.stringify({ error: 'Pipeline entry not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check transition rules
    const { data: transitionRules } = await supabase
      .from('transition_rules')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('from_status', fromStatus)
      .eq('to_status', newStatus)
      .eq('is_active', true);

    // If no specific rule found, use default permissions
    const isManager = ['manager', 'admin', 'master'].includes(profile.role);
    const isBackward = isStatusBackward(fromStatus, newStatus);
    
    if (transitionRules && transitionRules.length > 0) {
      const rule = transitionRules[0];
      
      // Check role permissions
      if (rule.required_role && !rule.required_role.includes(profile.role)) {
        return new Response(JSON.stringify({ 
          error: 'Insufficient permissions',
          message: `This transition requires one of the following roles: ${rule.required_role.join(', ')}`
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if reason is required
      if (rule.requires_reason && !reason) {
        return new Response(JSON.stringify({ 
          error: 'Reason required',
          message: 'Please provide a reason for this status change',
          requiresReason: true
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check minimum time in stage
      if (rule.min_time_in_stage_hours > 0 && pipelineEntry.status_entered_at) {
        const hoursInStage = (Date.now() - new Date(pipelineEntry.status_entered_at).getTime()) / (1000 * 60 * 60);
        if (hoursInStage < rule.min_time_in_stage_hours) {
          return new Response(JSON.stringify({ 
            error: 'Minimum time not met',
            message: `Job must remain in ${fromStatus} for at least ${rule.min_time_in_stage_hours} hours`
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Check if approval is required
      if (rule.requires_approval && !isManager) {
        return new Response(JSON.stringify({ 
          error: 'Manager approval required',
          message: 'This transition requires manager approval',
          requiresApproval: true
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Fallback to original permission logic if no rule found

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
    }

    // Check validation rules
    const { data: validations } = await supabase
      .from('transition_validations')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('applies_to_status', newStatus)
      .eq('is_active', true);

    if (validations && validations.length > 0) {
      for (const validation of validations) {
        if (validation.validation_type === 'document_required') {
          const { data: docs } = await supabase
            .from('documents')
            .select('id')
            .eq('pipeline_entry_id', pipelineEntryId)
            .eq('document_type', validation.validation_config.document_type);
          
          if (!docs || docs.length === 0) {
            return new Response(JSON.stringify({ 
              error: 'Validation failed',
              message: validation.error_message
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
    }

    // Update pipeline entry status
    const { error: updateError } = await supabase
      .from('pipeline_entries')
      .update({ 
        status: newStatus,
        status_entered_at: new Date().toISOString(),
        last_status_change_reason: reason || null,
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
    const { data: contactEntry } = await supabase
      .from('pipeline_entries')
      .select('contact_id')
      .eq('id', pipelineEntryId)
      .single();

    if (contactEntry?.contact_id) {
      await supabase
        .from('contacts')
        .update({ 
          qualification_status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactEntry.contact_id)
        .eq('tenant_id', profile.tenant_id);
    }

    // Log status transition history
    await supabase
      .from('status_transition_history')
      .insert({
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        from_status: fromStatus,
        to_status: newStatus,
        transitioned_by: user.id,
        transition_reason: reason || null,
        is_backward: isBackward,
        metadata: {
          user_name: `${profile.first_name} ${profile.last_name}`,
          timestamp: new Date().toISOString()
        }
      });

    // Log the pipeline activity
    await supabase
      .from('pipeline_activities')
      .insert({
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        contact_id: contactEntry?.contact_id,
        activity_type: 'status_change',
        title: `Stage changed from ${fromStatus} to ${newStatus}`,
        description: reason 
          ? `Pipeline entry moved from ${fromStatus} to ${newStatus} by ${profile.first_name} ${profile.last_name}. Reason: ${reason}`
          : `Pipeline entry moved from ${fromStatus} to ${newStatus} by ${profile.first_name} ${profile.last_name}`,
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
      isBackward: isBackward,
      autoApprovalCreated: newStatus === 'hold_mgr_review' && !isManager
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in pipeline drag handler:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper function to determine if a status change is backward
function isStatusBackward(fromStatus: string, toStatus: string): boolean {
  const statusOrder = [
    'lead',
    'legal_review',
    'legal',
    'contingency',
    'contingency_signed',
    'ready_for_approval',
    'project',
    'production',
    'final_payment',
    'completed',
    'closed'
  ];
  
  const fromIndex = statusOrder.indexOf(fromStatus);
  const toIndex = statusOrder.indexOf(toStatus);
  
  // If either status is not in the main flow, check special cases
  if (fromIndex === -1 || toIndex === -1) {
    const holdStatuses = ['hold_mgr_review', 'hold_customer', 'hold_materials'];
    const endStatuses = ['lost', 'canceled', 'duplicate'];
    
    // Moving to hold or end status is not considered backward
    if (holdStatuses.includes(toStatus) || endStatuses.includes(toStatus)) {
      return false;
    }
  }
  
  return fromIndex !== -1 && toIndex !== -1 && toIndex < fromIndex;
}