import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { channelId, callerNumber, did, timestamp } = await req.json();

    console.log('Inbound call webhook received:', { channelId, callerNumber, did });

    if (!channelId || !callerNumber || !did) {
      throw new Error('Missing required fields: channelId, callerNumber, did');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Find contact by phone number (E.164 format)
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, tenant_id, primary_address')
      .or(`phone_number.eq.${callerNumber},alt_phone.eq.${callerNumber}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    let contactId = contact?.id;
    let tenantId = contact?.tenant_id;
    let pipelineId = null;
    let campaignId = null;
    let assignedAgentId = null;

    // 2. Find active pipeline entry if contact exists
    if (contactId) {
      const { data: pipeline } = await supabase
        .from('pipeline_entries')
        .select('id, assigned_to, status, marketing_campaign')
        .eq('contact_id', contactId)
        .not('status', 'in', '(closed_won,closed_lost,disqualified)')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (pipeline) {
        pipelineId = pipeline.id;
        assignedAgentId = pipeline.assigned_to;
        campaignId = pipeline.marketing_campaign;
      }
    }

    // 3. Map DID to campaign and routing rules
    const { data: didCampaign } = await supabase
      .from('did_campaigns')
      .select('campaign_id, campaign_name, greeting_message, routing_type, assigned_agents, tenant_id')
      .eq('did', did)
      .eq('active', true)
      .single();

    if (didCampaign) {
      tenantId = tenantId || didCampaign.tenant_id;
      campaignId = campaignId || didCampaign.campaign_id;
    }

    // 4. Create call log
    const callLogId = crypto.randomUUID();
    const { error: callLogError } = await supabase
      .from('call_logs')
      .insert({
        id: callLogId,
        tenant_id: tenantId,
        contact_id: contactId,
        pipeline_entry_id: pipelineId,
        phone_number: callerNumber,
        direction: 'inbound',
        status: 'ringing',
        asterisk_channel_id: channelId,
        started_at: timestamp || new Date().toISOString(),
      });

    if (callLogError) {
      console.error('Error creating call log:', callLogError);
    }

    // 5. Create channel tracking
    const { error: channelError } = await supabase
      .from('asterisk_channels')
      .insert({
        tenant_id: tenantId,
        channel_id: channelId,
        call_log_id: callLogId,
        contact_id: contactId,
        pipeline_entry_id: pipelineId,
        agent_id: assignedAgentId,
        status: 'ringing',
      });

    if (channelError) {
      console.error('Error creating channel:', channelError);
    }

    // 6. Determine routing
    let action = 'voicemail';
    let agentExtension = null;

    if (assignedAgentId) {
      // Route to assigned agent
      action = 'bridge';
      agentExtension = `1${assignedAgentId.split('-')[0].substring(0, 3)}`; // Simple extension mapping
    } else if (didCampaign?.routing_type === 'round_robin' && didCampaign.assigned_agents?.length > 0) {
      // Round-robin to available agents
      action = 'bridge';
      const randomAgent = didCampaign.assigned_agents[Math.floor(Math.random() * didCampaign.assigned_agents.length)];
      agentExtension = `1${randomAgent.split('-')[0].substring(0, 3)}`;
      assignedAgentId = randomAgent;
    }

    console.log('Routing decision:', { action, agentExtension, assignedAgentId });

    return new Response(
      JSON.stringify({
        action,
        agentExtension,
        agentId: assignedAgentId,
        contactId,
        pipelineId,
        campaignId,
        greeting: didCampaign?.greeting_message || 'Thank you for calling',
        enableRecording: true,
        callId: callLogId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Inbound call webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
