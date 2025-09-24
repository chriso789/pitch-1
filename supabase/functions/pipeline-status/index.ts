import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

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

    // Define valid status transitions
    const validTransitions = {
      'lead': ['legal_review', 'lost', 'canceled', 'duplicate'],
      'legal_review': ['contingency_signed', 'lead', 'lost', 'canceled'],
      'contingency_signed': ['project', 'legal_review', 'lost', 'canceled'],
      'project': ['completed', 'contingency_signed', 'lost', 'canceled'],
      'completed': ['closed'],
      'lost': [],
      'canceled': [],
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
      .select()
      .single();

    if (error) {
      console.error('Update error:', error);
      return new Response(JSON.stringify({ error: 'Failed to update status' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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