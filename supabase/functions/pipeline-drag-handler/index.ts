import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Manager-level roles that can approve projects and move from ready_for_approval
const MANAGER_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];

// Legacy role mappings for backwards compatibility with transition_rules
const LEGACY_ROLE_MAPPINGS: Record<string, string[]> = {
  'admin': ['master', 'owner', 'corporate', 'office_admin'],
  'manager': ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'],
  'sales_rep': ['project_manager'],
};

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

    console.log(`[pipeline-drag-handler] User: ${user.id}, Role: ${profile.role}, Tenant: ${profile.tenant_id}`);

    const { pipelineEntryId, newStatus, fromStatus, reason } = await req.json();

    console.log(`[pipeline-drag-handler] Transition: ${fromStatus} -> ${newStatus}, Entry: ${pipelineEntryId}`);

    // Get pipeline entry details
    const { data: pipelineEntry } = await supabase
      .from('pipeline_entries')
      .select('*, status_entered_at, contact_id')
      .eq('id', pipelineEntryId)
      .single();

    if (!pipelineEntry) {
      return new Response(JSON.stringify({ error: 'Pipeline entry not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine if user has manager-level permissions using correct app_role values
    const isManager = MANAGER_ROLES.includes(profile.role);
    console.log(`[pipeline-drag-handler] isManager: ${isManager} (role: ${profile.role})`);

    // Check transition rules
    const { data: transitionRules } = await supabase
      .from('transition_rules')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('from_status', fromStatus)
      .eq('to_status', newStatus)
      .eq('is_active', true);

    const isBackward = isStatusBackward(fromStatus, newStatus);
    
    if (transitionRules && transitionRules.length > 0) {
      const rule = transitionRules[0];
      
      // Check role permissions with legacy mapping support
      if (rule.required_role && rule.required_role.length > 0) {
        const hasRequiredRole = rule.required_role.some((requiredRole: string) => {
          // Direct match
          if (requiredRole === profile.role) return true;
          // Legacy mapping: check if user's role is in the mapped roles
          const mappedRoles = LEGACY_ROLE_MAPPINGS[requiredRole];
          if (mappedRoles && mappedRoles.includes(profile.role)) return true;
          return false;
        });

        if (!hasRequiredRole) {
          console.log(`[pipeline-drag-handler] Role check failed. Required: ${rule.required_role.join(', ')}, User: ${profile.role}`);
          return new Response(JSON.stringify({ 
            error: 'Insufficient permissions',
            message: `This transition requires one of the following roles: ${rule.required_role.join(', ')}`
          }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
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
        console.log(`[pipeline-drag-handler] Blocking non-manager from moving out of ready_for_approval`);
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
        console.log(`[pipeline-drag-handler] Blocking non-manager from moving to project`);
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

    // SPECIAL HANDLING: If moving to 'project', create project record if not exists
    if (newStatus === 'project') {
      console.log(`[pipeline-drag-handler] Converting to project for pipeline entry: ${pipelineEntryId}`);
      
      // Check if project already exists for this pipeline entry
      const { data: existingProject } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId)
        .maybeSingle();

      if (!existingProject) {
        console.log(`[pipeline-drag-handler] Creating new project for pipeline entry: ${pipelineEntryId}`);
        
        // Get full pipeline entry with contact info for project creation
        const { data: fullEntry } = await supabase
          .from('pipeline_entries')
          .select(`
            *,
            contacts (
              id, first_name, last_name, address_street, address_city, address_state, address_zip
            )
          `)
          .eq('id', pipelineEntryId)
          .single();

        if (fullEntry) {
          const contact = fullEntry.contacts;
          const projectName = contact 
            ? `${contact.first_name} ${contact.last_name} - ${contact.address_street || 'Project'}`
            : `Project ${new Date().toISOString().split('T')[0]}`;

          // Create the project
          const { data: newProject, error: projectError } = await supabase
            .from('projects')
            .insert({
              tenant_id: profile.tenant_id,
              pipeline_entry_id: pipelineEntryId,
              contact_id: fullEntry.contact_id,
              location_id: fullEntry.location_id,
              name: projectName,
              status: 'active',
              project_type: fullEntry.lead_type || 'roofing',
              address_street: contact?.address_street,
              address_city: contact?.address_city,
              address_state: contact?.address_state,
              address_zip: contact?.address_zip,
              selling_price: fullEntry.selling_price,
              gross_profit: fullEntry.gross_profit,
              created_by: user.id,
              approved_by: user.id,
              approved_at: new Date().toISOString()
            })
            .select()
            .single();

          if (projectError) {
            console.error('[pipeline-drag-handler] Error creating project:', projectError);
            return new Response(JSON.stringify({ 
              error: 'Failed to create project',
              message: projectError.message 
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          console.log(`[pipeline-drag-handler] Project created: ${newProject.id}`);

          // Create production workflow
          try {
            await supabase
              .from('production_workflows')
              .insert({
                tenant_id: profile.tenant_id,
                project_id: newProject.id,
                status: 'scheduled',
                workflow_data: { initialized_from: 'pipeline_drag' }
              });
          } catch (workflowError) {
            console.error('[pipeline-drag-handler] Error creating workflow (non-fatal):', workflowError);
          }

          // Log the conversion
          await supabase
            .from('communication_history')
            .insert({
              tenant_id: profile.tenant_id,
              contact_id: fullEntry.contact_id,
              communication_type: 'system',
              direction: 'internal',
              subject: 'Lead Converted to Project',
              content: `Pipeline entry converted to project by ${profile.first_name} ${profile.last_name} via drag-and-drop`,
              rep_id: user.id,
              metadata: {
                pipeline_entry_id: pipelineEntryId,
                project_id: newProject.id,
                converted_by: `${profile.first_name} ${profile.last_name}`
              }
            });
        }
      } else {
        console.log(`[pipeline-drag-handler] Project already exists: ${existingProject.id}`);
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
          user_role: profile.role,
          timestamp: new Date().toISOString()
        }
      });

    // Log the pipeline activity
    await supabase
      .from('pipeline_activities')
      .insert({
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        contact_id: pipelineEntry?.contact_id,
        activity_type: 'status_change',
        title: `Stage changed from ${fromStatus} to ${newStatus}`,
        description: reason 
          ? `Pipeline entry moved from ${fromStatus} to ${newStatus} by ${profile.first_name} ${profile.last_name}. Reason: ${reason}`
          : `Pipeline entry moved from ${fromStatus} to ${newStatus} by ${profile.first_name} ${profile.last_name}`,
        status: 'completed'
      });

    // Auto-approve if moving to hold and user is NOT a manager
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

    console.log(`[pipeline-drag-handler] Success: ${fromStatus} -> ${newStatus}`);

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
