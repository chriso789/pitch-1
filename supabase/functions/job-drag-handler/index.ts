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

    const { jobId, newStatus, fromStatus } = await req.json();

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      'pending': ['in_progress', 'on_hold', 'cancelled'],
      'in_progress': ['completed', 'on_hold', 'cancelled'],
      'on_hold': ['pending', 'in_progress', 'cancelled'],
      'completed': [], // Completed jobs cannot be moved
      'cancelled': [] // Cancelled jobs cannot be moved
    };

    const allowedTransitions = validTransitions[fromStatus] || [];
    
    if (!allowedTransitions.includes(newStatus)) {
      console.log(`Invalid status transition: ${fromStatus} -> ${newStatus}`);
      return new Response(JSON.stringify({ 
        error: 'Invalid status transition',
        message: `Cannot move from ${fromStatus} to ${newStatus}. Allowed: ${allowedTransitions.join(', ')}`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update job status
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .eq('tenant_id', profile.tenant_id);

    if (updateError) {
      console.error('Error updating job:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update job' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log the job activity in communication history
    const { data: job } = await supabase
      .from('jobs')
      .select('contact_id, name, job_number')
      .eq('id', jobId)
      .single();

    if (job?.contact_id) {
      await supabase
        .from('communication_history')
        .insert({
          tenant_id: profile.tenant_id,
          contact_id: job.contact_id,
          communication_type: 'system',
          direction: 'internal',
          subject: `Job Status Updated`,
          content: `Job ${job.job_number || job.name} moved from ${fromStatus} to ${newStatus}`,
          rep_id: user.id,
          metadata: {
            job_id: jobId,
            from_status: fromStatus,
            to_status: newStatus,
            changed_by: `${profile.first_name} ${profile.last_name}`
          }
        });
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: `Job moved to ${newStatus}`,
      newStatus: newStatus
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in job drag handler:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});