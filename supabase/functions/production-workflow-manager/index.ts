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

async function advanceStage(supabase: any, profile: any, jobId?: string, projectId?: string, newStage?: string, notes?: string, userId?: string) {
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

  // Check stage requirements
  const requirements = STAGE_REQUIREMENTS[workflow.current_stage] || [];
  for (const requirement of requirements) {
    if (!workflow[requirement]) {
      return new Response(JSON.stringify({ 
        error: `Cannot advance from ${workflow.current_stage}. Missing requirement: ${requirement}`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

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
      notes: notes || `Stage advanced from ${workflow.current_stage} to ${newStage}`,
      changed_at: new Date().toISOString()
    });

  return new Response(JSON.stringify({
    success: true,
    previous_stage: workflow.current_stage,
    new_stage: newStage,
    message: `Production stage advanced to ${newStage}`
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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