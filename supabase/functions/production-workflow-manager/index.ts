import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface WorkflowRequest {
  action: 'advance_stage' | 'update_documents' | 'get_workflow' | 'create_workflow';
  job_id?: string;
  project_id?: string;
  pipeline_entry_id?: string;
  new_stage?: string;
  document_updates?: {
    noc_uploaded?: boolean;
    permit_application_submitted?: boolean;
    permit_approved?: boolean;
    materials_ordered?: boolean;
    materials_delivered?: boolean;
    work_completed?: boolean;
    final_inspection_passed?: boolean;
  };
  notes?: string;
}

const STAGE_ORDER: { [key: string]: number } = {
  'submit_documents': 1,
  'permit_submitted': 2,
  'permit_approved': 3,
  'materials_ordered': 4,
  'materials_on_hold': 5,
  'materials_delivered': 6,
  'in_progress': 7,
  'complete': 8,
  'final_inspection': 9,
  'final_check_needed': 10,
  'closed': 11
};

const STAGE_REQUIREMENTS: { [key: string]: string[] } = {
  'submit_documents': ['noc_uploaded', 'permit_application_submitted'],
  'permit_submitted': [],
  'permit_approved': ['permit_approved'],
  'materials_ordered': ['materials_ordered'],
  'materials_on_hold': [],
  'materials_delivered': ['materials_delivered'],
  'in_progress': [],
  'complete': ['work_completed'],
  'final_inspection': ['final_inspection_passed'],
  'final_check_needed': [],
  'closed': []
};

serve(async (req) => {
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

    const { action, job_id, project_id, pipeline_entry_id, new_stage, document_updates, notes } = await req.json() as WorkflowRequest;

    switch (action) {
      case 'create_workflow':
        return await createWorkflow(supabase, profile, user.id, job_id, project_id, pipeline_entry_id);
      
      case 'get_workflow':
        return await getWorkflow(supabase, profile, job_id, project_id);
      
      case 'advance_stage':
        return await advanceStage(supabase, profile, job_id, project_id, new_stage, notes, user.id);
      
      case 'update_documents':
        return await updateDocuments(supabase, profile, job_id, project_id, document_updates, user.id);
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    console.error('Error in production-workflow-manager:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function createWorkflow(supabase: any, profile: any, userId: string, jobId?: string, projectId?: string, pipelineEntryId?: string) {
  if (!jobId && !projectId) {
    return new Response(JSON.stringify({ error: 'Job ID or Project ID required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check if workflow already exists
  const { data: existingWorkflow } = await supabase
    .from('production_workflows')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq(jobId ? 'job_id' : 'project_id', jobId || projectId)
    .single();

  if (existingWorkflow) {
    return new Response(JSON.stringify({ 
      success: true, 
      workflow: existingWorkflow,
      message: 'Workflow already exists'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Create new workflow
  const workflowData = {
    tenant_id: profile.tenant_id,
    job_id: jobId,
    project_id: projectId,
    pipeline_entry_id: pipelineEntryId,
    current_stage: 'submit_documents',
    created_by: userId,
    stage_history: [{
      stage: 'submit_documents',
      entered_at: new Date().toISOString(),
      entered_by: userId,
      notes: 'Production workflow started'
    }]
  };

  const { data: newWorkflow, error: workflowError } = await supabase
    .from('production_workflows')
    .insert(workflowData)
    .select()
    .single();

  if (workflowError) {
    console.error('Error creating workflow:', workflowError);
    return new Response(JSON.stringify({ error: 'Failed to create workflow' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    workflow: newWorkflow,
    message: 'Production workflow created successfully'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getWorkflow(supabase: any, profile: any, jobId?: string, projectId?: string) {
  if (!jobId && !projectId) {
    return new Response(JSON.stringify({ error: 'Job ID or Project ID required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: workflow, error: workflowError } = await supabase
    .from('production_workflows')
    .select(`
      *,
      jobs(name, job_number, status),
      projects(name, project_number, status)
    `)
    .eq('tenant_id', profile.tenant_id)
    .eq(jobId ? 'job_id' : 'project_id', jobId || projectId)
    .single();

  if (workflowError || !workflow) {
    return new Response(JSON.stringify({ error: 'Workflow not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get stage history
  const { data: stageHistory } = await supabase
    .from('production_stage_history')
    .select(`
      *,
      profiles!changed_by(first_name, last_name)
    `)
    .eq('production_workflow_id', workflow.id)
    .order('changed_at', { ascending: false });

  return new Response(JSON.stringify({
    success: true,
    workflow: {
      ...workflow,
      stage_history: stageHistory || []
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function advanceStage(supabase: any, profile: any, jobId?: string, projectId?: string, newStage?: string, notes?: string, userId?: string, bypassGate?: boolean, bypassReason?: string) {
  if (!jobId && !projectId) {
    return new Response(JSON.stringify({ error: 'Job ID or Project ID required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!newStage) {
    return new Response(JSON.stringify({ error: 'New stage is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get current workflow
  const { data: workflow, error: workflowError } = await supabase
    .from('production_workflows')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq(jobId ? 'job_id' : 'project_id', jobId || projectId)
    .single();

  if (workflowError || !workflow) {
    return new Response(JSON.stringify({ error: 'Workflow not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate stage transition
  const currentStageOrder = STAGE_ORDER[workflow.current_stage] || 0;
  const newStageOrder = STAGE_ORDER[newStage] || 0;

  // Allow backwards movement for corrections, but prevent skipping stages forward
  if (newStageOrder > currentStageOrder + 1) {
    return new Response(JSON.stringify({ 
      error: `Cannot skip from ${workflow.current_stage} to ${newStage}. Must progress through stages sequentially.`
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // === PHASE 11: Enhanced Gate Validation ===
  const gateValidationResult = await validateGateRequirements(
    supabase, 
    profile, 
    workflow, 
    workflow.current_stage, 
    newStage,
    userId
  );

  if (!gateValidationResult.passed && !bypassGate) {
    // Log failed validation
    await supabase.from('production_gate_validations').insert({
      tenant_id: profile.tenant_id,
      project_id: workflow.project_id,
      from_stage: workflow.current_stage,
      to_stage: newStage,
      validation_status: 'failed',
      validation_results: gateValidationResult.details,
      validated_by: userId,
      validated_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({ 
      error: `Gate requirements not met for ${newStage}`,
      gate_failures: gateValidationResult.failures,
      details: gateValidationResult.details
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Log gate validation (passed or bypassed)
  await supabase.from('production_gate_validations').insert({
    tenant_id: profile.tenant_id,
    project_id: workflow.project_id,
    from_stage: workflow.current_stage,
    to_stage: newStage,
    validation_status: bypassGate ? 'bypassed' : 'passed',
    validation_results: gateValidationResult.details,
    bypassed_by: bypassGate ? userId : null,
    bypass_reason: bypassReason,
    validated_by: userId,
    validated_at: new Date().toISOString()
  });

  // Update workflow stage
  const { error: updateError } = await supabase
    .from('production_workflows')
    .update({
      current_stage: newStage,
      updated_at: new Date().toISOString()
    })
    .eq('id', workflow.id);

  if (updateError) {
    console.error('Error updating workflow stage:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to update workflow stage' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Log stage history
  await supabase
    .from('production_stage_history')
    .insert({
      tenant_id: profile.tenant_id,
      production_workflow_id: workflow.id,
      from_stage: workflow.current_stage,
      to_stage: newStage,
      changed_by: userId,
      notes: notes || `Stage advanced from ${workflow.current_stage} to ${newStage}${bypassGate ? ' (gate bypassed)' : ''}`,
      changed_at: new Date().toISOString()
    });

  return new Response(JSON.stringify({
    success: true,
    previous_stage: workflow.current_stage,
    new_stage: newStage,
    gate_validated: !bypassGate,
    gate_bypassed: bypassGate,
    message: `Production stage advanced to ${newStage}`
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// === PHASE 11: Gate Requirements Validation Function ===
async function validateGateRequirements(
  supabase: any, 
  profile: any, 
  workflow: any, 
  fromStage: string, 
  toStage: string,
  userId: string
): Promise<{
  passed: boolean;
  failures: string[];
  details: Record<string, any>;
}> {
  const failures: string[] = [];
  const details: Record<string, any> = {
    checked_at: new Date().toISOString(),
    from_stage: fromStage,
    to_stage: toStage
  };

  // Get project details for more comprehensive validation
  const { data: project } = await supabase
    .from('projects')
    .select('*, contacts(*)')
    .eq('id', workflow.project_id)
    .single();

  // Stage-specific hard requirements
  const stageRequirements = STAGE_REQUIREMENTS[fromStage] || [];
  
  for (const requirement of stageRequirements) {
    const met = workflow[requirement] === true;
    details[requirement] = met;
    if (!met) {
      failures.push(`Missing requirement: ${requirement.replace(/_/g, ' ')}`);
    }
  }

  // === Critical Gate Checks ===
  
  // NOC Gate: Cannot proceed to materials_ordered without NOC
  if (toStage === 'materials_ordered' && !workflow.noc_uploaded) {
    failures.push('NOC document must be uploaded before ordering materials');
    details.noc_gate_failed = true;
  }

  // Permit Gate: Cannot start work without permit approval
  if (['in_progress', 'complete'].includes(toStage) && !workflow.permit_approved) {
    failures.push('Building permit must be approved before starting work');
    details.permit_gate_failed = true;
  }

  // Material Delivery Gate: Cannot start work without materials
  if (toStage === 'in_progress' && !workflow.materials_delivered) {
    failures.push('Materials must be delivered before starting work');
    details.materials_gate_failed = true;
  }

  // Photo Documentation Gate: Check minimum photos per stage
  if (project) {
    const { count: photoCount } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id);

    const minPhotosPerStage: Record<string, number> = {
      'in_progress': 5,
      'complete': 10,
      'final_inspection': 15
    };

    const requiredPhotos = minPhotosPerStage[toStage] || 0;
    if (photoCount < requiredPhotos) {
      failures.push(`Minimum ${requiredPhotos} photos required (current: ${photoCount})`);
      details.photo_count = photoCount;
      details.required_photos = requiredPhotos;
    }
  }

  // Final Inspection Gate: Work must be completed
  if (toStage === 'final_inspection' && !workflow.work_completed) {
    failures.push('Work must be marked complete before scheduling final inspection');
    details.completion_gate_failed = true;
  }

  // Closed Gate: Final inspection must pass
  if (toStage === 'closed' && !workflow.final_inspection_passed) {
    failures.push('Final inspection must pass before closing project');
    details.inspection_gate_failed = true;
  }

  return {
    passed: failures.length === 0,
    failures,
    details
  };
}

async function updateDocuments(supabase: any, profile: any, jobId?: string, projectId?: string, documentUpdates?: any, userId?: string) {
  if (!jobId && !projectId) {
    return new Response(JSON.stringify({ error: 'Job ID or Project ID required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!documentUpdates) {
    return new Response(JSON.stringify({ error: 'Document updates are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Update workflow document status
  const { data: updatedWorkflow, error: updateError } = await supabase
    .from('production_workflows')
    .update({
      ...documentUpdates,
      updated_at: new Date().toISOString()
    })
    .eq('tenant_id', profile.tenant_id)
    .eq(jobId ? 'job_id' : 'project_id', jobId || projectId)
    .select()
    .single();

  if (updateError) {
    console.error('Error updating workflow documents:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to update workflow documents' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Log document updates
  const updateDescriptions = Object.entries(documentUpdates)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  await supabase
    .from('production_stage_history')
    .insert({
      tenant_id: profile.tenant_id,
      production_workflow_id: updatedWorkflow.id,
      to_stage: updatedWorkflow.current_stage,
      changed_by: userId,
      notes: `Document updates: ${updateDescriptions}`,
      changed_at: new Date().toISOString()
    });

  return new Response(JSON.stringify({
    success: true,
    workflow: updatedWorkflow,
    updates: documentUpdates,
    message: 'Document status updated successfully'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}