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
    if (!['admin', 'manager', 'master'].includes(profile.role)) {
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

    // Create project record (for Production board)
    const projectData = {
      tenant_id: profile.tenant_id,
      pipeline_entry_id: pipelineEntryId,
      name: jobDetails?.name || `${pipelineEntry.contacts?.first_name} ${pipelineEntry.contacts?.last_name} - ${pipelineEntry.contacts?.address_street}`,
      description: jobDetails?.description || `Project created from pipeline entry for ${pipelineEntry.roof_type}`,
      status: 'active',
      created_by: user.id
    };

    const { data: newProject, error: projectError } = await supabase
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
          direction: 'internal',
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

    return new Response(JSON.stringify({ 
      success: true,
      project: newProject,
      project_id: newProject.id,
      project_clj_number: newProject.clj_formatted_number,
      message: `Successfully converted lead to project`
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