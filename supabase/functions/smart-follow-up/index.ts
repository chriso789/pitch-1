import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface FollowUpRequest {
  action: 'create_campaign' | 'trigger_follow_up' | 'analyze_leads' | 'send_scheduled';
  data?: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, data = {} }: FollowUpRequest = await req.json();
    
    console.log('Smart follow-up action:', action);

    // Initialize Supabase client
    const supabase = supabaseService();

    // Get user context
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('User authentication failed');
    }

    const tenantId = user.user_metadata?.tenant_id;

    switch (action) {
      case 'analyze_leads':
        return await analyzeLeadsForFollowUp(supabase, tenantId);
      
      case 'create_campaign':
        return await createFollowUpCampaign(supabase, tenantId, data, user.id);
      
      case 'trigger_follow_up':
        return await triggerFollowUp(supabase, tenantId, data);
      
      case 'send_scheduled':
        return await sendScheduledFollowUps(supabase, tenantId);
      
      default:
        throw new Error('Invalid action');
    }

  } catch (error) {
    console.error('Error in smart-follow-up:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function analyzeLeadsForFollowUp(supabase: any, tenantId: string) {
  // Get leads that need follow-up
  const { data: leadsNeedingFollowUp } = await supabase
    .from('pipeline_entries')
    .select(`
      *,
      contacts(*),
      communication_history(*),
      estimates(*)
    `)
    .eq('tenant_id', tenantId)
    .not('status', 'in', '("closed_won", "closed_lost")');

  if (!leadsNeedingFollowUp) {
    return new Response(
      JSON.stringify({ leads_analyzed: 0, follow_ups_scheduled: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Analyze each lead with AI
  const analysisPrompt = `Analyze these roofing leads and determine follow-up priority and strategy:

  ${JSON.stringify(leadsNeedingFollowUp, null, 2)}

  For each lead, consider:
  - Time since last contact
  - Lead temperature (engagement level)
  - Estimate status and timing
  - Seasonal factors for roofing
  - Pipeline stage and progression

  Return JSON with follow-up recommendations:
  {
    "leads_analysis": [
      {
        "pipeline_entry_id": "uuid",
        "priority": "high|medium|low",
        "follow_up_type": "call|email|sms|meeting",
        "timing": "immediate|today|this_week|next_week",
        "message_strategy": "personalized message approach",
        "reason": "why this follow-up is recommended"
      }
    ],
    "summary": "Overall analysis summary"
  }`;

  const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 2000
    }),
  });

  if (!openAIResponse.ok) {
    throw new Error('Failed to analyze leads');
  }

  const aiResult = await openAIResponse.json();
  const analysis = JSON.parse(aiResult.choices[0].message.content);

  // Create follow-up instances based on analysis
  let followUpsScheduled = 0;
  for (const leadAnalysis of analysis.leads_analysis) {
    try {
      const scheduledFor = calculateFollowUpTime(leadAnalysis.timing);
      
      await supabase.from('follow_up_instances').insert({
        tenant_id: tenantId,
        pipeline_entry_id: leadAnalysis.pipeline_entry_id,
        step_index: 0,
        scheduled_for: scheduledFor,
        status: 'pending'
      });

      followUpsScheduled++;
    } catch (error) {
      console.error('Error scheduling follow-up:', error);
    }
  }

  return new Response(
    JSON.stringify({
      leads_analyzed: leadsNeedingFollowUp.length,
      follow_ups_scheduled: followUpsScheduled,
      analysis_summary: analysis.summary
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function createFollowUpCampaign(supabase: any, tenantId: string, campaignData: any, userId: string) {
  const defaultSequence = [
    {
      delay_hours: 24,
      type: 'email',
      subject: 'Following up on your roofing project',
      content: 'Hi {first_name}, I wanted to follow up on our discussion about your roofing needs...'
    },
    {
      delay_hours: 72,
      type: 'sms',
      content: 'Hi {first_name}, just checking in about your roof estimate. Any questions I can answer?'
    },
    {
      delay_hours: 168, // 1 week
      type: 'call',
      content: 'Schedule call to discuss project timeline and next steps'
    }
  ];

  const { data: campaign, error } = await supabase
    .from('follow_up_campaigns')
    .insert({
      tenant_id: tenantId,
      name: campaignData.name || 'Smart Follow-up Campaign',
      description: campaignData.description || 'AI-generated follow-up sequence',
      trigger_event: campaignData.trigger_event || 'status_change',
      trigger_conditions: campaignData.trigger_conditions || { status: 'qualified' },
      sequence_steps: campaignData.sequence_steps || defaultSequence,
      is_active: true,
      created_by: userId
    })
    .select()
    .single();

  if (error) throw error;

  return new Response(
    JSON.stringify({ campaign }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function triggerFollowUp(supabase: any, tenantId: string, triggerData: any) {
  const { pipeline_entry_id, trigger_type } = triggerData;

  // Find active campaigns that match this trigger
  const { data: campaigns } = await supabase
    .from('follow_up_campaigns')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('trigger_event', trigger_type);

  if (!campaigns || campaigns.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No matching campaigns found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let instancesCreated = 0;
  for (const campaign of campaigns) {
    for (let stepIndex = 0; stepIndex < campaign.sequence_steps.length; stepIndex++) {
      const step = campaign.sequence_steps[stepIndex];
      const scheduledFor = new Date(Date.now() + (step.delay_hours * 60 * 60 * 1000));

      try {
        await supabase.from('follow_up_instances').insert({
          tenant_id: tenantId,
          campaign_id: campaign.id,
          pipeline_entry_id,
          step_index: stepIndex,
          scheduled_for: scheduledFor.toISOString(),
          status: 'pending'
        });

        instancesCreated++;
      } catch (error) {
        console.error('Error creating follow-up instance:', error);
      }
    }
  }

  return new Response(
    JSON.stringify({ instances_created: instancesCreated }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function sendScheduledFollowUps(supabase: any, tenantId: string) {
  // Get pending follow-ups that are due
  const now = new Date().toISOString();
  const { data: dueFollowUps } = await supabase
    .from('follow_up_instances')
    .select(`
      *,
      follow_up_campaigns(*),
      pipeline_entries(*),
      contacts(*)
    `)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .lte('scheduled_for', now);

  if (!dueFollowUps || dueFollowUps.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No follow-ups due' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sentCount = 0;
  for (const followUp of dueFollowUps) {
    try {
      const campaign = followUp.follow_up_campaigns;
      const step = campaign.sequence_steps[followUp.step_index];
      
      // Simulate sending (in real implementation, integrate with email/SMS service)
      console.log(`Sending ${step.type} follow-up to ${followUp.contacts?.email}`);
      
      // Mark as sent
      await supabase
        .from('follow_up_instances')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          delivery_status: { type: step.type, status: 'sent' }
        })
        .eq('id', followUp.id);

      sentCount++;
    } catch (error) {
      console.error('Error sending follow-up:', error);
    }
  }

  return new Response(
    JSON.stringify({ follow_ups_sent: sentCount }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function calculateFollowUpTime(timing: string): string {
  const now = new Date();
  
  switch (timing) {
    case 'immediate':
      return now.toISOString();
    case 'today':
      now.setHours(now.getHours() + 2);
      return now.toISOString();
    case 'this_week':
      now.setDate(now.getDate() + 2);
      return now.toISOString();
    case 'next_week':
      now.setDate(now.getDate() + 7);
      return now.toISOString();
    default:
      now.setHours(now.getHours() + 24);
      return now.toISOString();
  }
}