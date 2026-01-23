import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAuth } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = supabaseAuth(req);

    const { pipeline_id, new_status } = await req.json();

    // Validate status transition (PITCH rules: no skipping stages)
    const { data: currentEntry, error: fetchError } = await supabaseClient
      .from('pipeline_entries')
      .select('status')
      .eq('id', pipeline_id)
      .single();

    if (fetchError) {
      return new Response(JSON.stringify({ error: 'Pipeline entry not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Define valid status transitions matching LEAD_STAGES from usePipelineData.ts
    // Stages: lead -> qualified -> contingency_signed -> legal_review -> ready_for_approval -> project
    const validTransitions: Record<string, string[]> = {
      'lead': ['qualified', 'lost', 'canceled', 'duplicate'],
      'qualified': ['contingency_signed', 'lead', 'lost', 'canceled'],
      'contingency_signed': ['legal_review', 'qualified', 'lost', 'canceled'],
      'legal_review': ['ready_for_approval', 'contingency_signed', 'lost', 'canceled'],
      'ready_for_approval': ['project', 'legal_review', 'lost', 'canceled'],
      'project': ['completed', 'ready_for_approval', 'lost', 'canceled'],
      'completed': ['closed'],
      'lost': ['lead'], // Allow re-opening lost leads
      'canceled': ['lead'], // Allow re-opening canceled leads
      'duplicate': [],
      'closed': []
    };

    const currentStatus = currentEntry.status;
    const allowedStatuses = validTransitions[currentStatus] || [];

    if (!allowedStatuses.includes(new_status)) {
      return new Response(JSON.stringify({ 
        error: `Invalid status transition from ${currentStatus} to ${new_status}. Allowed: ${allowedStatuses.join(', ')}` 
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update the pipeline entry status
    const { data, error } = await supabaseClient
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

    // Also sync the status to the linked contact's qualification_status
    if (data?.contact_id) {
      const { error: contactError } = await supabaseClient
        .from('contacts')
        .update({ 
          qualification_status: new_status, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', data.contact_id);

      if (contactError) {
        console.error('Contact sync error:', contactError);
        // Non-fatal: pipeline was updated, just log contact sync failure
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      pipeline_entry: data,
      message: `Status updated from ${currentStatus} to ${new_status}`
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