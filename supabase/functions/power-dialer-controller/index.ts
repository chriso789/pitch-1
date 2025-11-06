import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DialerRequest {
  action: 'start' | 'pause' | 'resume' | 'stop' | 'next-contact' | 'disposition';
  sessionId?: string;
  campaignId?: string;
  mode?: 'preview' | 'power' | 'predictive';
  disposition?: string;
  contactId?: string;
  notes?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) throw new Error('Profile not found');

    const body: DialerRequest = await req.json();
    console.log('Power Dialer Request:', body);

    let result;
    switch (body.action) {
      case 'start':
        result = await startDialerSession(supabaseClient, profile.tenant_id, body);
        break;
      case 'pause':
        result = await pauseDialerSession(supabaseClient, body.sessionId!);
        break;
      case 'resume':
        result = await resumeDialerSession(supabaseClient, body.sessionId!);
        break;
      case 'stop':
        result = await stopDialerSession(supabaseClient, body.sessionId!);
        break;
      case 'next-contact':
        result = await getNextContact(supabaseClient, body.sessionId!, body.mode!);
        break;
      case 'disposition':
        result = await handleDisposition(supabaseClient, body);
        break;
      default:
        throw new Error('Invalid action');
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in power-dialer-controller:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function startDialerSession(supabase: any, tenantId: string, body: DialerRequest) {
  console.log('Starting dialer session:', { tenantId, mode: body.mode, campaignId: body.campaignId });

  // Create or get power dialer agent
  let { data: agent } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('agent_type', 'power_dialer')
    .single();

  if (!agent) {
    const { data: newAgent, error: agentError } = await supabase
      .from('ai_agents')
      .insert({
        tenant_id: tenantId,
        agent_type: 'power_dialer',
        name: 'Power Dialer Agent',
        status: 'active',
        config: { default_mode: body.mode || 'power' }
      })
      .select()
      .single();

    if (agentError) throw agentError;
    agent = newAgent;
  } else {
    await supabase
      .from('ai_agents')
      .update({ status: 'active' })
      .eq('id', agent.id);
  }

  // Create dialer session
  const { data: session, error: sessionError } = await supabase
    .from('power_dialer_sessions')
    .insert({
      tenant_id: tenantId,
      agent_id: agent.id,
      campaign_id: body.campaignId,
      mode: body.mode || 'power',
      status: 'active'
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  console.log('Dialer session started:', session.id);

  return {
    success: true,
    session,
    agent
  };
}

async function pauseDialerSession(supabase: any, sessionId: string) {
  const { error } = await supabase
    .from('power_dialer_sessions')
    .update({ status: 'paused' })
    .eq('id', sessionId);

  if (error) throw error;

  return { success: true, message: 'Session paused' };
}

async function resumeDialerSession(supabase: any, sessionId: string) {
  const { error } = await supabase
    .from('power_dialer_sessions')
    .update({ status: 'active' })
    .eq('id', sessionId);

  if (error) throw error;

  return { success: true, message: 'Session resumed' };
}

async function stopDialerSession(supabase: any, sessionId: string) {
  const { error } = await supabase
    .from('power_dialer_sessions')
    .update({ 
      status: 'completed',
      ended_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  if (error) throw error;

  // Update agent status
  const { data: session } = await supabase
    .from('power_dialer_sessions')
    .select('agent_id')
    .eq('id', sessionId)
    .single();

  if (session?.agent_id) {
    await supabase
      .from('ai_agents')
      .update({ status: 'inactive' })
      .eq('id', session.agent_id);
  }

  return { success: true, message: 'Session stopped' };
}

async function getNextContact(supabase: any, sessionId: string, mode: string) {
  console.log('Getting next contact for session:', sessionId, 'mode:', mode);

  // Get session details
  const { data: session } = await supabase
    .from('power_dialer_sessions')
    .select('*, dialer_campaigns(*)')
    .eq('id', sessionId)
    .single();

  if (!session) throw new Error('Session not found');

  // Get contacts from campaign or pipeline
  let query = supabase
    .from('contacts')
    .select('*, pipeline_entries(*)')
    .eq('tenant_id', session.tenant_id)
    .order('created_at', { ascending: false });

  if (session.campaign_id && session.dialer_campaigns?.list_id) {
    query = query.eq('list_id', session.dialer_campaigns.list_id);
  }

  // Exclude already called today
  const today = new Date().toISOString().split('T')[0];
  const { data: calledToday } = await supabase
    .from('call_logs')
    .select('contact_id')
    .eq('tenant_id', session.tenant_id)
    .gte('created_at', today);

  const calledIds = calledToday?.map((c: any) => c.contact_id) || [];

  if (calledIds.length > 0) {
    query = query.not('id', 'in', `(${calledIds.join(',')})`);
  }

  const { data: contacts, error } = await query.limit(mode === 'predictive' ? 3 : 1);

  if (error) throw error;
  if (!contacts || contacts.length === 0) {
    return { success: true, contact: null, message: 'No more contacts in queue' };
  }

  // Update session metrics
  await supabase
    .from('power_dialer_sessions')
    .update({ 
      contacts_attempted: session.contacts_attempted + 1 
    })
    .eq('id', sessionId);

  return {
    success: true,
    contact: contacts[0],
    nextContacts: mode === 'predictive' ? contacts.slice(1) : [],
    queueSize: contacts.length
  };
}

async function handleDisposition(supabase: any, body: DialerRequest) {
  console.log('Handling disposition:', body);

  if (!body.contactId || !body.sessionId) {
    throw new Error('Contact ID and Session ID required');
  }

  // Get session
  const { data: session } = await supabase
    .from('power_dialer_sessions')
    .select('*')
    .eq('id', body.sessionId)
    .single();

  if (!session) throw new Error('Session not found');

  // Update pipeline entry if needed
  if (body.disposition === 'interested' || body.disposition === 'callback') {
    const { data: pipelineEntry } = await supabase
      .from('pipeline_entries')
      .select('*')
      .eq('contact_id', body.contactId)
      .eq('tenant_id', session.tenant_id)
      .maybeSingle();

    if (pipelineEntry) {
      await supabase
        .from('pipeline_entries')
        .update({
          status: body.disposition === 'interested' ? 'qualified' : 'follow_up',
          last_activity_at: new Date().toISOString()
        })
        .eq('id', pipelineEntry.id);
    }
  }

  // Update session metrics
  const updates: any = {};
  if (body.disposition === 'answered' || body.disposition === 'interested') {
    updates.contacts_reached = session.contacts_reached + 1;
  }
  if (body.disposition === 'interested' || body.disposition === 'converted') {
    updates.contacts_converted = session.contacts_converted + 1;
  }

  if (Object.keys(updates).length > 0) {
    await supabase
      .from('power_dialer_sessions')
      .update(updates)
      .eq('id', body.sessionId);
  }

  // Log communication
  await supabase
    .from('communication_history')
    .insert({
      tenant_id: session.tenant_id,
      contact_id: body.contactId,
      type: 'call',
      direction: 'outbound',
      status: body.disposition,
      notes: body.notes || '',
      occurred_at: new Date().toISOString()
    });

  return {
    success: true,
    message: 'Disposition recorded'
  };
}
