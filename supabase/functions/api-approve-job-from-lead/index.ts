import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
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

    const { pipelineEntryId, jobDetails } = await req.json();

    if (!pipelineEntryId) {
      return new Response(JSON.stringify({ error: 'Pipeline entry ID is required' }), {
        status: 400,
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

    // Check if user has permission to approve jobs
    // master and owner can always override, others need appropriate role
    const canOverrideConversion = ['master', 'owner'].includes(profile.role);
    const hasApprovalPermission = ['master', 'owner', 'office_admin', 'regional_manager', 'sales_manager', 'corporate'].includes(profile.role);
    
    if (!hasApprovalPermission) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get pipeline entry with contact details
    const { data: pipelineEntry, error: pipelineError } = await supabase
      .from('pipeline_entries')
      .select(`
        *,
        contacts(*)
      `)
      .eq('id', pipelineEntryId)
      .eq('tenant_id', profile.tenant_id)
      .single();

    if (pipelineError || !pipelineEntry) {
      return new Response(JSON.stringify({ error: 'Pipeline entry not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Approval Gate Enforcement: EVERY lead -> project conversion requires
    // an approved manager_approval_queue row. Only master/owner roles may
    // override (overrides are recorded by the DB audit trigger).
    const estimatedValue = pipelineEntry.estimated_value || 0;

    if (!canOverrideConversion) {
      const { data: approvalCheck } = await supabase
        .from('manager_approval_queue')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('status', 'approved')
        .order('reviewed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!approvalCheck) {
        return new Response(
          JSON.stringify({
            error: 'Manager approval required to convert this lead into a project',
            requires_approval: true,
            estimated_value: estimatedValue,
            clj_number: pipelineEntry.clj_formatted_number,
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // PR #3 Address Gate: Lead -> Project conversion requires a canonical
    // property_address with status 'valid' or 'override_accepted' on either
    // the pipeline_entry or its underlying contact. Master/owner bypass.
    // Managers are NOT bypassed automatically — they use the override flow
    // exposed via AddressValidationResolutionModal (PR #3A).
    const OVERRIDE_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];
    const canOverrideAddress = OVERRIDE_ROLES.includes(profile.role);
    if (!canOverrideConversion) {
      const candidateIds: Array<{ type: string; id: string }> = [
        { type: 'pipeline_entry', id: pipelineEntryId },
      ];
      if (pipelineEntry.contact_id) {
        candidateIds.push({ type: 'contact', id: pipelineEntry.contact_id });
      }
      const { data: addrRows } = await supabase
        .from('property_addresses')
        .select('id, source_entity_type, source_entity_id, validation_status')
        .eq('tenant_id', profile.tenant_id)
        .is('archived_at', null)
        .in('source_entity_id', candidateIds.map((c) => c.id));
      const scoped = (addrRows ?? []).filter((r) =>
        candidateIds.some((c) => c.type === r.source_entity_type && c.id === r.source_entity_id),
      );
      const readyRow = scoped.find(
        (r) => r.validation_status === 'valid' || r.validation_status === 'override_accepted',
      );
      if (!readyRow) {
        const currentRow = scoped[0] ?? null;
        return new Response(
          JSON.stringify({
            error: 'address_validation_required',
            code: 'address_validation_required',
            message:
              'A valid or manager-overridden project address is required before converting this lead to a project.',
            source_entity_type: 'pipeline_entry',
            source_entity_id: pipelineEntryId,
            contact_id: pipelineEntry.contact_id ?? null,
            property_address_id: currentRow?.id ?? null,
            validation_status: currentRow?.validation_status ?? 'unvalidated',
            required_for_action: 'lead_to_project',
            can_override: canOverrideAddress,
            allowed_override_roles: ['sales_manager', 'regional_manager', 'office_admin', 'corporate', 'owner', 'master'],
            clj_number: pipelineEntry.clj_formatted_number,
          }),
          { status: 412, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }


    // Reuse existing project for this pipeline entry if one already exists
    // (DB trigger create_production_workflow may have created it, or a prior
    // approval attempt partially completed).
    const { data: existingProject } = await supabase
      .from('projects')
      .select('*')
      .eq('pipeline_entry_id', pipelineEntryId)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle();

    let newProject: any = existingProject;

    if (!newProject) {
      const projectData = {
        tenant_id: profile.tenant_id,
        pipeline_entry_id: pipelineEntryId,
        name: jobDetails?.name || `${pipelineEntry.contacts?.first_name} ${pipelineEntry.contacts?.last_name} - ${pipelineEntry.contacts?.address_street}`,
        description: jobDetails?.description || `Project created from pipeline entry for ${pipelineEntry.roof_type}`,
        status: 'active',
        created_by: user.id
      };

      const { data: insertedProject, error: projectError } = await supabase
        .from('projects')
        .insert(projectData)
        .select()
        .single();

      if (projectError) {
        console.error('Error creating project:', projectError);
        return new Response(JSON.stringify({ error: 'Failed to create project' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      newProject = insertedProject;
    }

    // Update pipeline entry status to 'project'
    const { error: updateError } = await supabase
      .from('pipeline_entries')
      .update({ 
        status: 'project',
        updated_at: new Date().toISOString()
      })
      .eq('id', pipelineEntryId)
      .eq('tenant_id', profile.tenant_id);

    if (updateError) {
      console.error('Error updating pipeline entry:', updateError);
    }

    // Log the conversion in communication history
    if (pipelineEntry.contact_id) {
      await supabase
        .from('communication_history')
        .insert({
          tenant_id: profile.tenant_id,
          contact_id: pipelineEntry.contact_id,
          project_id: newProject.id,
          pipeline_entry_id: pipelineEntryId,
          communication_type: 'system',
          direction: 'outbound',
          subject: 'Lead Converted to Project',
          content: `Pipeline entry converted to project by ${profile.first_name} ${profile.last_name}`,
          rep_id: user.id,
          metadata: {
            project_id: newProject.id,
            conversion_type: 'pipeline_to_project',
            converted_by: `${profile.first_name} ${profile.last_name}`
          }
        });
    }

    // Create initial production workflow
    const { data: workflow, error: workflowError } = await supabase
      .from('production_workflows')
      .insert({
        tenant_id: profile.tenant_id,
        project_id: newProject.id,
        pipeline_entry_id: pipelineEntryId,
        current_stage: 'submit_documents',
        created_by: user.id
      })
      .select()
      .single();

    if (!workflowError && workflow) {
      // Log the initial production stage
      await supabase
        .from('production_stage_history')
        .insert({
          tenant_id: profile.tenant_id,
          production_workflow_id: workflow.id,
          to_stage: 'submit_documents',
          changed_by: user.id,
          notes: 'Production workflow started from approved lead'
        });
    }

    // Create Pre-Cap and Cap-Out budget snapshots from estimate
    try {
      // Fetch the latest estimate for this pipeline entry
      const { data: estimates } = await supabase
        .from('enhanced_estimates')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false })
        .limit(1);

      const estimate = estimates?.[0];

      if (estimate && estimate.line_items && Array.isArray(estimate.line_items)) {
        // Transform estimate line items to budget format
        const budgetLines = estimate.line_items.map((item: any) => ({
          kind: item.category === 'labor' ? 'LABOR' : 'MATERIAL',
          code: item.code || item.name,
          name: item.name,
          uom: item.unit || 'EA',
          qty: item.quantity || 0,
          unit_price: item.unit_price || 0,
          unit_cost: item.unit_cost || (item.unit_price || 0) * 0.6, // Default 40% markup if no cost
          markup_pct: item.markup_percent ? item.markup_percent / 100 : 0,
        }));

        // Call snapshot RPC to create Pre-Cap and Cap-Out
        const { error: snapshotError } = await supabase.rpc('api_snapshot_precap_and_capout', {
          p_job_id: newProject.id,
          p_lines: budgetLines,
          p_overhead_amount: estimate.overhead_amount || 0,
          p_commission_amount: estimate.sales_rep_commission_amount || 0,
          p_misc_amount: estimate.permit_costs || 0,
          p_estimate_ref: estimate.id,
        });

        if (snapshotError) {
          console.error('Error creating budget snapshots:', snapshotError);
          // Don't fail the entire operation if budget snapshot fails
        } else {
          console.log('Budget snapshots created successfully for project:', newProject.id);
        }
      }
    } catch (budgetError) {
      console.error('Error in budget snapshot creation:', budgetError);
      // Don't fail the entire operation
    }

    // Sync the newly converted project to QuickBooks (create Customer + Sub-Customer/Project).
    // Only runs when the tenant has an active QBO connection; failures are logged but do not
    // block the conversion — QBO can be re-synced from the project page.
    let qboSync: any = { attempted: false };
    try {
      const { data: activeQbo } = await supabase
        .from('qbo_connections')
        .select('id, realm_id, status')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'active')
        .maybeSingle();

      if (activeQbo?.id) {
        qboSync.attempted = true;
        const workerRes = await fetch(`${supabaseUrl}/functions/v1/qbo-worker`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({
            op: 'syncProject',
            args: { project_id: newProject.id },
          }),
        });
        const workerBody = await workerRes.json().catch(() => ({}));
        qboSync = {
          attempted: true,
          ok: workerRes.ok,
          status: workerRes.status,
          qbo_customer_id: workerBody?.data?.qbo_customer_id ?? null,
          qbo_project_or_job_id: workerBody?.data?.qbo_project_or_job_id ?? null,
          mapping_mode: workerBody?.data?.mapping_mode ?? null,
          error: workerRes.ok ? null : (workerBody?.error ?? workerBody?.message ?? 'qbo_sync_failed'),
        };
        if (!workerRes.ok) {
          console.error('[api-approve-job-from-lead] QBO syncProject failed', qboSync);
        }
      }
    } catch (qboError: any) {
      console.error('[api-approve-job-from-lead] QBO sync threw:', qboError);
      qboSync = { attempted: true, ok: false, error: qboError?.message ?? String(qboError) };
    }


    // Initialize immutable project accounting snapshot (Slice 1). Never blocks
    // conversion — the Project Accounting Panel can re-run it manually if needed.
    let accountingInit: any = { attempted: false };
    try {
      accountingInit.attempted = true;
      const acctRes = await fetch(`${supabaseUrl}/functions/v1/initialize-project-accounting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ project_id: newProject.id }),
      });
      const acctBody = await acctRes.json().catch(() => ({}));
      accountingInit = {
        attempted: true,
        ok: acctRes.ok,
        status: acctRes.status,
        snapshot_id: acctBody?.data?.snapshot?.id ?? null,
        readiness: acctBody?.data?.readiness ?? null,
        created: acctBody?.data?.created ?? null,
        error: acctRes.ok ? null : (acctBody?.error ?? 'accounting_init_failed'),
      };
      if (!acctRes.ok) {
        console.error('[api-approve-job-from-lead] accounting init failed', accountingInit);
      }
    } catch (acctErr: any) {
      console.error('[api-approve-job-from-lead] accounting init threw:', acctErr);
      accountingInit = { attempted: true, ok: false, error: acctErr?.message ?? String(acctErr) };
    }

    return new Response(JSON.stringify({
      success: true,
      project: newProject,
      project_id: newProject.id,
      project_job_number: newProject.project_number,
      qbo_sync: qboSync,
      accounting_init: accountingInit,
      message: `Successfully converted lead to project ${newProject.project_number}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });


  } catch (error) {
    console.error('Error in api-approve-job-from-lead:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});