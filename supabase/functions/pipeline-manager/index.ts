import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestData {
  action: string;
  data?: any;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, data }: RequestData = await req.json();
    
    // Get authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get user from auth header
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Invalid authorization token');
    }

    // Get user's tenant ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('User tenant not found');
    }

    const tenantId = profile.tenant_id;

    let result;
    switch (action) {
      case 'initialize_default_stages':
        result = await initializeDefaultStages(supabase, tenantId);
        break;
      case 'update_stage_probabilities':
        result = await updateStageProbabilities(supabase, tenantId, data);
        break;
      case 'bulk_move_entries':
        result = await bulkMoveEntries(supabase, tenantId, data);
        break;
      case 'get_pipeline_analytics':
        result = await getPipelineAnalytics(supabase, tenantId);
        break;
      case 'auto_stage_progression':
        result = await autoStageProgression(supabase, tenantId, data);
        break;
      case 'auto_generate_measurements':
        result = await autoGenerateMeasurements(supabase, tenantId, data);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Pipeline manager error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function initializeDefaultStages(supabase: any, tenantId: string) {
  const defaultStages = [
    { name: 'New Lead', description: 'Fresh leads that need initial contact', stage_order: 1, probability_percent: 10, color: '#ef4444' },
    { name: 'Contacted', description: 'Lead has been contacted but not qualified', stage_order: 2, probability_percent: 25, color: '#f59e0b' },
    { name: 'Qualified', description: 'Lead meets qualification criteria', stage_order: 3, probability_percent: 50, color: '#eab308' },
    { name: 'Appointment Set', description: 'Appointment scheduled with lead', stage_order: 4, probability_percent: 70, color: '#3b82f6' },
    { name: 'Proposal Sent', description: 'Estimate/proposal has been sent', stage_order: 5, probability_percent: 80, color: '#8b5cf6' },
    { name: 'Negotiating', description: 'In active negotiation phase', stage_order: 6, probability_percent: 90, color: '#06b6d4' },
    { name: 'Closed Won', description: 'Deal successfully closed', stage_order: 7, probability_percent: 100, color: '#10b981' },
    { name: 'Closed Lost', description: 'Deal lost or disqualified', stage_order: 8, probability_percent: 0, color: '#6b7280' }
  ];

  const stagesToInsert = defaultStages.map(stage => ({
    ...stage,
    tenant_id: tenantId
  }));

  const { data, error } = await supabase
    .from('pipeline_stages')
    .upsert(stagesToInsert, { onConflict: 'tenant_id,name' });

  if (error) throw error;

  return { success: true, stages: data };
}

async function updateStageProbabilities(supabase: any, tenantId: string, data: { stage_id: string; probability_percent: number }[]) {
  const updates = [];
  
  for (const update of data) {
    const { error } = await supabase
      .from('pipeline_stages')
      .update({ probability_percent: update.probability_percent })
      .eq('id', update.stage_id)
      .eq('tenant_id', tenantId);
    
    if (error) {
      console.error('Error updating stage probability:', error);
    } else {
      updates.push(update);
    }
  }

  return { success: true, updated: updates.length };
}

async function bulkMoveEntries(supabase: any, tenantId: string, data: { entry_ids: string[]; new_stage: string }) {
  const { entry_ids, new_stage } = data;
  
  const { error } = await supabase
    .from('pipeline_entries')
    .update({ status: new_stage })
    .in('id', entry_ids)
    .eq('tenant_id', tenantId);

  if (error) throw error;

  // Log bulk move activity
  const activities = entry_ids.map(entryId => ({
    tenant_id: tenantId,
    pipeline_entry_id: entryId,
    activity_type: 'status_change',
    title: `Bulk moved to ${new_stage}`,
    description: `Pipeline entry bulk moved to ${new_stage}`,
    status: 'completed'
  }));

  await supabase
    .from('pipeline_activities')
    .insert(activities);

  return { success: true, moved: entry_ids.length };
}

async function getPipelineAnalytics(supabase: any, tenantId: string) {
  // Get pipeline entries with stage info
  const { data: entries, error } = await supabase
    .from('pipeline_entries')
    .select(`
      *,
      contacts (
        first_name,
        last_name,
        lead_score
      )
    `)
    .eq('tenant_id', tenantId);

  if (error) throw error;

  // Get stages
  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('stage_order');

  // Calculate analytics
  const analytics = {
    total_entries: entries.length,
    total_value: entries.reduce((sum: number, entry: any) => sum + (entry.estimated_value || 0), 0),
    avg_lead_score: entries.reduce((sum: number, entry: any) => sum + (entry.contacts?.lead_score || 0), 0) / entries.length,
    stage_distribution: {} as Record<string, number>,
    conversion_rates: {} as Record<string, number>
  };

  // Stage distribution
  stages?.forEach((stage: any) => {
    const stageEntries = entries.filter((entry: any) => entry.status === stage.name.toLowerCase());
    analytics.stage_distribution[stage.name] = stageEntries.length;
  });

  // Simple conversion rate calculation (entries in stage / total entries)
  const totalEntries = entries.length;
  stages?.forEach((stage: any) => {
    const stageCount = analytics.stage_distribution[stage.name] || 0;
    analytics.conversion_rates[stage.name] = totalEntries > 0 ? (stageCount / totalEntries) * 100 : 0;
  });

  return analytics;
}

async function autoStageProgression(supabase: any, tenantId: string, data: { entry_id: string }) {
  const { entry_id } = data;

  // Get the pipeline entry with activities
  const { data: entry } = await supabase
    .from('pipeline_entries')
    .select(`
      *,
      contacts (
        lead_score,
        qualification_status
      )
    `)
    .eq('id', entry_id)
    .eq('tenant_id', tenantId)
    .single();

  if (!entry) throw new Error('Pipeline entry not found');

  // Get recent activities for this entry
  const { data: activities } = await supabase
    .from('pipeline_activities')
    .select('*')
    .eq('pipeline_entry_id', entry_id)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Simple auto-progression logic
  let suggestedStage = entry.status;
  
  // If lead score is high and has recent activity, suggest progression
  if (entry.contacts?.lead_score > 70 && activities?.length > 0) {
    const recentActivity = activities[0];
    const daysSinceActivity = (Date.now() - new Date(recentActivity.created_at).getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceActivity < 7) {
      // Progress one stage forward based on current stage
      switch (entry.status) {
        case 'lead':
          suggestedStage = 'contacted';
          break;
        case 'contacted':
          suggestedStage = 'qualified';
          break;
        case 'qualified':
          suggestedStage = 'appointment_set';
          break;
      }
    }
  }

  return {
    current_stage: entry.status,
    suggested_stage: suggestedStage,
    progression_needed: suggestedStage !== entry.status,
    reasoning: 'Based on lead score and recent activity'
  };
}

async function autoGenerateMeasurements(supabase: any, tenantId: string, data: { pipeline_entry_id: string }) {
  const { pipeline_entry_id } = data;

  // Call the auto-generate-measurements function
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/auto-generate-measurements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ pipeline_entry_id })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error calling auto-generate-measurements:', error);
    throw error;
  }
}