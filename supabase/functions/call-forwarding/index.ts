import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');

  try {
    const { action, ...params } = await req.json();

    console.log('Call forwarding action:', action, params);

    switch (action) {
      case 'configure':
        return await configureForwarding(supabase, params);
      case 'forward':
        return await forwardCall(supabase, TELNYX_API_KEY, params);
      case 'transfer':
        return await transferCall(TELNYX_API_KEY, params);
      case 'get-rules':
        return await getForwardingRules(supabase, params);
      case 'route-inbound':
        return await routeInboundCall(supabase, params);
      default:
        throw new Error('Invalid action');
    }
  } catch (error) {
    console.error('Call forwarding error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function configureForwarding(supabase: any, params: any) {
  const { tenantId, userId, rules, locationId } = params;
  
  // Store forwarding rules in database
  const { data, error } = await supabase
    .from('call_forwarding_rules')
    .upsert({
      tenant_id: tenantId,
      user_id: userId,
      rules: {
        ...rules,
        location_id: locationId,
      },
      is_active: true,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id,user_id'
    })
    .select()
    .single();

  if (error) throw error;

  console.log('Forwarding rules configured:', data);

  return new Response(
    JSON.stringify({ success: true, data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function forwardCall(supabase: any, telnyxApiKey: string | undefined, params: any) {
  const { fromNumber, toNumber, tenantId, userId, callControlId, locationId } = params;
  
  // Get forwarding rules for user or location
  let rules = null;

  // First try location-specific rules
  if (locationId) {
    const { data: locationRules } = await supabase
      .from('call_forwarding_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .contains('rules', { location_id: locationId })
      .eq('is_active', true)
      .limit(1)
      .single();
    
    if (locationRules) rules = locationRules;
  }

  // Fall back to user rules
  if (!rules && userId) {
    const { data: userRules } = await supabase
      .from('call_forwarding_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    
    if (userRules) rules = userRules;
  }

  // Fall back to tenant-level rules
  if (!rules) {
    const { data: tenantRules } = await supabase
      .from('call_forwarding_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    
    if (tenantRules) rules = tenantRules;
  }

  if (!rules) {
    // No rules configured, trigger AI answering service
    return await triggerAnsweringService(supabase, telnyxApiKey, {
      fromNumber,
      toNumber,
      tenantId,
      callControlId,
      locationId
    });
  }

  // Get forwarding numbers based on rules
  const forwardingNumbers = getForwardingNumbers(rules.rules, toNumber);
  
  console.log('Forwarding numbers:', forwardingNumbers);

  // Attempt to transfer call using Telnyx
  for (const number of forwardingNumbers) {
    const success = await attemptTelnyxTransfer(supabase, telnyxApiKey, {
      callControlId,
      toNumber: number,
      fromNumber,
      tenantId,
      locationId
    });

    if (success) {
      await logCallForward(supabase, fromNumber, toNumber, number, 'success', tenantId, locationId);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          forwardedTo: number,
          originalNumber: toNumber 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // All forwarding attempts failed, trigger answering service
  return await triggerAnsweringService(supabase, telnyxApiKey, {
    fromNumber,
    toNumber,
    tenantId,
    callControlId,
    locationId
  });
}

async function transferCall(telnyxApiKey: string | undefined, params: any) {
  const { callControlId, toNumber, fromNumber } = params;

  if (!telnyxApiKey) {
    throw new Error('Telnyx API key not configured');
  }

  if (!callControlId) {
    throw new Error('Call control ID required for transfer');
  }

  console.log('Transferring call:', { callControlId, toNumber });

  const response = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: toNumber,
      from: fromNumber,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Telnyx transfer error:', data);
    throw new Error(data.errors?.[0]?.detail || 'Transfer failed');
  }

  console.log('Transfer initiated:', data);

  return new Response(
    JSON.stringify({ success: true, data: data.data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function getForwardingRules(supabase: any, params: any) {
  const { tenantId, userId, locationId } = params;
  
  let query = supabase
    .from('call_forwarding_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return new Response(
    JSON.stringify({ rules: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function routeInboundCall(supabase: any, params: any) {
  const { toNumber, fromNumber, callControlId } = params;

  console.log('Routing inbound call:', { toNumber, fromNumber });

  // Look up location by phone number
  const cleanedPhone = toNumber?.replace(/[^\d+]/g, '') || '';
  
  const { data: location } = await supabase
    .from('locations')
    .select('id, name, tenant_id, manager_id, telnyx_phone_number')
    .or(`telnyx_phone_number.eq.${cleanedPhone},telnyx_phone_number.eq.+${cleanedPhone.replace(/^\+/, '')}`)
    .single();

  if (location) {
    console.log('Found location for inbound call:', location.name);

    // Get AI answering config
    const { data: aiConfig } = await supabase
      .from('ai_answering_config')
      .select('is_enabled, business_hours, greeting_text')
      .eq('tenant_id', location.tenant_id)
      .single();

    // Check if within business hours
    const isBusinessHours = checkBusinessHours(aiConfig?.business_hours);

    // Get forwarding rules for this location
    const { data: rules } = await supabase
      .from('call_forwarding_rules')
      .select('rules')
      .eq('tenant_id', location.tenant_id)
      .eq('is_active', true)
      .limit(1)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        routing: {
          tenantId: location.tenant_id,
          locationId: location.id,
          locationName: location.name,
          managerId: location.manager_id,
          aiAnsweringEnabled: aiConfig?.is_enabled || false,
          isBusinessHours,
          forwardingRules: rules?.rules || null,
          greeting: aiConfig?.greeting_text || null,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // No location found, return default routing
  return new Response(
    JSON.stringify({
      success: true,
      routing: {
        tenantId: null,
        locationId: null,
        aiAnsweringEnabled: false,
        isBusinessHours: true,
        forwardingRules: null,
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function checkBusinessHours(businessHours: any): boolean {
  if (!businessHours) return true; // Default to business hours if not configured

  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const todayHours = businessHours[currentDay];
  if (!todayHours || !todayHours.open) return false;

  const [startHour, startMin] = (todayHours.start || '09:00').split(':').map(Number);
  const [endHour, endMin] = (todayHours.end || '17:00').split(':').map(Number);
  
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  return currentTime >= startTime && currentTime <= endTime;
}

function getForwardingNumbers(rules: any, originalNumber: string): string[] {
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentDay = currentTime.getDay();
  
  let forwardingNumbers: string[] = [];
  
  // Time-based routing
  if (rules.timeRouting) {
    const timeRule = rules.timeRouting.find((rule: any) => {
      return currentHour >= rule.startHour && currentHour < rule.endHour &&
             rule.days.includes(currentDay);
    });
    
    if (timeRule) {
      forwardingNumbers = [...timeRule.numbers];
    }
  }
  
  // Geographic routing based on area code
  if (rules.geographicRouting && forwardingNumbers.length === 0) {
    const areaCode = originalNumber.replace(/[^\d]/g, '').substring(0, 3);
    const geoRule = rules.geographicRouting[areaCode];
    
    if (geoRule) {
      forwardingNumbers = [...geoRule.numbers];
    }
  }
  
  // Default forwarding numbers
  if (forwardingNumbers.length === 0 && rules.defaultNumbers) {
    forwardingNumbers = [...rules.defaultNumbers];
  }
  
  // Apply distribution strategy
  if (rules.distributionStrategy === 'round-robin') {
    return rotateNumbers(forwardingNumbers);
  }
  
  return forwardingNumbers;
}

function rotateNumbers(numbers: string[]): string[] {
  const rotated = [...numbers];
  const first = rotated.shift();
  if (first) rotated.push(first);
  return rotated;
}

async function attemptTelnyxTransfer(
  supabase: any,
  telnyxApiKey: string | undefined,
  params: { callControlId?: string; toNumber: string; fromNumber: string; tenantId: string; locationId?: string }
): Promise<boolean> {
  if (!telnyxApiKey || !params.callControlId) {
    console.log('No Telnyx API key or call control ID, simulating transfer');
    // Log the attempt
    await logCallActivity(supabase, params.fromNumber, params.toNumber, 'transfer_simulated', params.tenantId, params.locationId);
    return true; // Simulate success for testing
  }

  try {
    console.log(`Attempting Telnyx transfer from ${params.fromNumber} to ${params.toNumber}`);
    
    const response = await fetch(`https://api.telnyx.com/v2/calls/${params.callControlId}/actions/transfer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.toNumber,
        from: params.fromNumber,
        timeout_secs: 30,
        answering_machine_detection: 'detect',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Telnyx transfer failed:', data);
      await logCallActivity(supabase, params.fromNumber, params.toNumber, 'transfer_failed', params.tenantId, params.locationId);
      return false;
    }

    console.log('Telnyx transfer successful:', data.data?.result);
    await logCallActivity(supabase, params.fromNumber, params.toNumber, 'transferred', params.tenantId, params.locationId);
    return true;
  } catch (error) {
    console.error(`Transfer error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

async function triggerAnsweringService(
  supabase: any, 
  telnyxApiKey: string | undefined,
  params: { fromNumber: string; toNumber: string; tenantId: string; callControlId?: string; locationId?: string }
) {
  console.log(`Triggering answering service for call from ${params.fromNumber}`);
  
  // Log the answering service activation
  await logCallActivity(supabase, params.fromNumber, params.toNumber, 'answered_by_ai', params.tenantId, params.locationId);

  // If we have a call control ID, we can have Telnyx play a message or connect to AI
  if (telnyxApiKey && params.callControlId) {
    try {
      // Get AI config for greeting
      const { data: aiConfig } = await supabase
        .from('ai_answering_config')
        .select('greeting_text, ai_voice')
        .eq('tenant_id', params.tenantId)
        .single();

      const greeting = aiConfig?.greeting_text || 
        "Thank you for calling. All of our representatives are currently busy. Please leave a message after the tone.";

      // Use Telnyx speak to play greeting
      await fetch(`https://api.telnyx.com/v2/calls/${params.callControlId}/actions/speak`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: greeting,
          voice: aiConfig?.ai_voice || 'female',
          language: 'en-US',
        }),
      });

      console.log('AI greeting played');
    } catch (error) {
      console.error('Failed to play AI greeting:', error);
    }
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      forwardedTo: 'answering-service',
      message: 'Call handled by AI answering service',
      locationId: params.locationId
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function logCallForward(
  supabase: any, 
  fromNumber: string, 
  originalNumber: string, 
  forwardedNumber: string, 
  status: string, 
  tenantId: string,
  locationId?: string
) {
  await supabase
    .from('call_forwarding_log')
    .insert({
      tenant_id: tenantId,
      from_number: fromNumber,
      original_number: originalNumber,
      forwarded_number: forwardedNumber,
      status: status,
      timestamp: new Date().toISOString()
    });

  // Also log to call_activity_log
  await logCallActivity(supabase, fromNumber, forwardedNumber, `forwarded_${status}`, tenantId, locationId);
}

async function logCallActivity(
  supabase: any, 
  fromNumber: string, 
  toNumber: string, 
  activity: string, 
  tenantId: string | null,
  locationId?: string
) {
  if (!tenantId) return;
  
  await supabase
    .from('call_activity_log')
    .insert({
      tenant_id: tenantId,
      location_id: locationId || null,
      from_number: fromNumber,
      to_number: toNumber,
      activity: activity,
      status: 'completed',
      metadata: {
        timestamp: new Date().toISOString(),
      }
    });
}
