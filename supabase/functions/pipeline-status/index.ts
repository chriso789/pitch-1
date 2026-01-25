import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAuth, supabaseService, getAuthUser } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Manager roles that can override transition rules
const MANAGER_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated
    const authClient = supabaseAuth(req);
    const authUser = await getAuthUser(authClient);
    
    if (!authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { pipeline_id, new_status, transition_reason } = await req.json();

    // Use service client to bypass RLS for the query
    const serviceClient = supabaseService();

    // Validate status transition (PITCH rules: no skipping stages)
    const { data: currentEntry, error: fetchError } = await serviceClient
      .from('pipeline_entries')
      .select('status, tenant_id')
      .eq('id', pipeline_id)
      .single();

    if (fetchError || !currentEntry) {
      return new Response(JSON.stringify({ error: 'Pipeline entry not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user belongs to same tenant
    if (authUser.tenantId !== currentEntry.tenant_id) {
      return new Response(JSON.stringify({ error: 'Access denied - tenant mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user has manager role
    const { data: userProfile } = await serviceClient
      .from('profiles')
      .select('role')
      .eq('id', authUser.id)
      .single();

    const isManager = userProfile?.role && MANAGER_ROLES.includes(userProfile.role);

    // Define valid status transitions for regular users
    const validTransitions: Record<string, string[]> = {
      'lead': ['contingency_signed', 'lost', 'canceled', 'duplicate'],
      'contingency_signed': ['legal_review', 'lead', 'lost', 'canceled'],
      'legal_review': ['ready_for_approval', 'contingency_signed', 'lost', 'canceled'],
      'ready_for_approval': ['project', 'legal_review', 'lost', 'canceled'],
      'project': ['completed', 'ready_for_approval', 'lost', 'canceled'],
      'completed': ['closed'],
      'lost': ['lead'],
      'canceled': ['lead'],
      'duplicate': [],
      'closed': []
    };

    // All valid statuses for manager override
    const allStatuses = ['lead', 'contingency_signed', 'legal_review', 'ready_for_approval', 'project', 'completed', 'closed', 'lost', 'canceled', 'duplicate'];

    const currentStatus = currentEntry.status;
    const allowedStatuses = validTransitions[currentStatus] || [];
    const isValidTransition = allowedStatuses.includes(new_status);
    const isManagerOverride = !isValidTransition && isManager;

    // Check if this transition is allowed
    if (!isValidTransition) {
      if (!isManager) {
        return new Response(JSON.stringify({ 
          error: `Invalid status transition from ${currentStatus} to ${new_status}. Contact a manager to override.`,
          allowed: allowedStatuses
        }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Manager override: require reason for non-standard jumps (except to terminal statuses)
      const terminalStatuses = ['lost', 'canceled', 'duplicate'];
      if (!terminalStatuses.includes(new_status) && !transition_reason) {
        return new Response(JSON.stringify({ 
          error: 'Manager override requires a reason for this status change',
          requires_reason: true
        }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Validate the target status exists
      if (!allStatuses.includes(new_status)) {
        return new Response(JSON.stringify({ 
          error: `Invalid target status: ${new_status}`
        }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Update the pipeline entry status using service client
    const { data, error } = await serviceClient
      .from('pipeline_entries')
      .update({ status: new_status, updated_at: new Date().toISOString() })
      .eq('id', pipeline_id)
      .select('*, contacts(id)')
      .single();

    if (error) {
      console.error('Update error:', error);
      return new Response(JSON.stringify({ error: 'Failed to update status' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log the status change to audit_log
    try {
      await serviceClient.from('audit_log').insert({
        tenant_id: currentEntry.tenant_id,
        changed_by: authUser.id,
        action: 'UPDATE',
        table_name: 'pipeline_entries',
        record_id: pipeline_id,
        old_values: { status: currentStatus },
        new_values: { 
          status: new_status,
          is_manager_override: isManagerOverride,
          transition_reason: transition_reason || null
        }
      });
    } catch (auditError) {
      console.error('Audit log error (non-fatal):', auditError);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      pipeline_entry: data,
      message: `Status updated from ${currentStatus} to ${new_status}`,
      is_manager_override: isManagerOverride
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in pipeline-status function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});