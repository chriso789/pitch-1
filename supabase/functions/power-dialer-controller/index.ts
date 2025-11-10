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

// Rate Limiting Configuration
const RATE_LIMITS = {
  // API request limits per tenant
  requestsPerMinute: 60,
  requestsPerHour: 500,
  
  // Call limits per session (compliance)
  maxCallsPerHour: 100,
  maxCallsPerDay: 800,
  
  // Session limits
  maxActiveSessions: 5,
  maxSessionDuration: 8 * 60 * 60 * 1000, // 8 hours
};

interface RateLimitError extends Error {
  status: number;
  retryAfter?: number;
}

function createRateLimitError(message: string, retryAfter?: number): RateLimitError {
  const error = new Error(message) as RateLimitError;
  error.status = 429;
  error.retryAfter = retryAfter;
  return error;
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
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) throw new Error('Profile not found');
    const tenantId = profile.active_tenant_id || profile.tenant_id;

    // Check API rate limits
    await checkRateLimit(supabaseClient, profile.tenant_id, user.id);

    const body: DialerRequest = await req.json();
    console.log('Power Dialer Request:', body);

    // Additional throttling checks for calling actions
    if (body.action === 'next-contact' && body.sessionId) {
      await checkCallThrottling(supabaseClient, body.sessionId);
    }

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
    
    const status = (error as RateLimitError).status || 500;
    const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
    
    if ((error as RateLimitError).retryAfter) {
      headers['Retry-After'] = String((error as RateLimitError).retryAfter);
      headers['X-RateLimit-Reset'] = String(Date.now() + ((error as RateLimitError).retryAfter! * 1000));
    }
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        rateLimitExceeded: status === 429
      }),
      { status, headers }
    );
  }
});

async function checkRateLimit(supabase: any, tenantId: string, userId: string) {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Check requests in last minute
  const { count: minuteCount } = await supabase
    .from('api_rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .gte('created_at', oneMinuteAgo.toISOString());

  if (minuteCount >= RATE_LIMITS.requestsPerMinute) {
    const retryAfter = 60;
    console.warn(`Rate limit exceeded for tenant ${tenantId}: ${minuteCount} requests/minute`);
    throw createRateLimitError(
      `Rate limit exceeded: ${RATE_LIMITS.requestsPerMinute} requests per minute allowed`,
      retryAfter
    );
  }

  // Check requests in last hour
  const { count: hourCount } = await supabase
    .from('api_rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo.toISOString());

  if (hourCount >= RATE_LIMITS.requestsPerHour) {
    const retryAfter = 3600;
    console.warn(`Rate limit exceeded for tenant ${tenantId}: ${hourCount} requests/hour`);
    throw createRateLimitError(
      `Rate limit exceeded: ${RATE_LIMITS.requestsPerHour} requests per hour allowed`,
      retryAfter
    );
  }

  // Log this request
  await supabase
    .from('api_rate_limits')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      endpoint: 'power-dialer-controller',
      created_at: now.toISOString()
    });

  console.log(`Rate limit check passed: ${minuteCount}/min, ${hourCount}/hour`);
}

async function checkCallThrottling(supabase: any, sessionId: string) {
  const { data: session } = await supabase
    .from('power_dialer_sessions')
    .select('*, ai_agents(configuration)')
    .eq('id', sessionId)
    .single();

  if (!session) throw new Error('Session not found');

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Check calls in last hour
  const { count: hourCallCount } = await supabase
    .from('call_logs')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('created_at', oneHourAgo.toISOString());

  // Get configured max calls per hour from agent config
  const agentConfig = session.ai_agents?.configuration || {};
  const maxCallsPerHour = agentConfig.maxCallsPerHour || RATE_LIMITS.maxCallsPerHour;

  if (hourCallCount >= maxCallsPerHour) {
    const retryAfter = 3600;
    console.warn(`Call throttling: ${hourCallCount} calls in last hour (limit: ${maxCallsPerHour})`);
    throw createRateLimitError(
      `Call rate limit exceeded: ${maxCallsPerHour} calls per hour allowed. This ensures compliance with calling regulations.`,
      retryAfter
    );
  }

  // Check calls today
  const { count: dayCallCount } = await supabase
    .from('call_logs')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('created_at', todayStart.toISOString());

  if (dayCallCount >= RATE_LIMITS.maxCallsPerDay) {
    const retryAfter = 86400;
    console.warn(`Daily call limit exceeded: ${dayCallCount} calls today`);
    throw createRateLimitError(
      `Daily call limit exceeded: ${RATE_LIMITS.maxCallsPerDay} calls per day allowed`,
      retryAfter
    );
  }

  // Check session duration
  const sessionStart = new Date(session.started_at || session.created_at);
  const sessionDuration = now.getTime() - sessionStart.getTime();

  if (sessionDuration > RATE_LIMITS.maxSessionDuration) {
    console.warn(`Session duration exceeded: ${sessionDuration}ms`);
    throw createRateLimitError(
      'Maximum session duration exceeded (8 hours). Please start a new session.',
      3600
    );
  }

  console.log(`Call throttling check passed: ${hourCallCount}/${maxCallsPerHour} calls/hour, ${dayCallCount}/${RATE_LIMITS.maxCallsPerDay} calls/day`);
}

async function startDialerSession(supabase: any, tenantId: string, body: DialerRequest) {
  console.log('Starting dialer session:', { tenantId, mode: body.mode, campaignId: body.campaignId });

  // Check active session limits
  const { count: activeSessionCount } = await supabase
    .from('power_dialer_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'paused']);

  if (activeSessionCount >= RATE_LIMITS.maxActiveSessions) {
    throw createRateLimitError(
      `Maximum active sessions limit reached (${RATE_LIMITS.maxActiveSessions}). Please stop an existing session before starting a new one.`,
      300
    );
  }

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
      status: 'active',
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  console.log('Dialer session started:', session.id);
  console.log(`Rate limits applied: ${activeSessionCount + 1}/${RATE_LIMITS.maxActiveSessions} active sessions`);

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
      contacts_attempted: session.contacts_attempted + 1,
      last_activity_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  // Create call log entry for throttling tracking
  await supabase
    .from('call_logs')
    .insert({
      tenant_id: session.tenant_id,
      session_id: sessionId,
      contact_id: contacts[0].id,
      phone_number: contacts[0].phone,
      status: 'initiated',
      created_at: new Date().toISOString()
    });

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
