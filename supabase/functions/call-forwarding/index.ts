import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      case 'configure':
        return await configureForwarding(params);
      case 'forward':
        return await forwardCall(params);
      case 'get-rules':
        return await getForwardingRules(params);
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

async function configureForwarding(params: any) {
  const { tenantId, userId, rules } = params;
  
  // Store forwarding rules in database
  const { data, error } = await supabase
    .from('call_forwarding_rules')
    .upsert({
      tenant_id: tenantId,
      user_id: userId,
      rules: rules,
      is_active: true,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;

  return new Response(
    JSON.stringify({ success: true, data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function forwardCall(params: any) {
  const { fromNumber, toNumber, tenantId, userId } = params;
  
  // Get forwarding rules for user
  const { data: rules, error } = await supabase
    .from('call_forwarding_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (error || !rules) {
    return await handleDefaultForwarding(fromNumber, toNumber);
  }

  // Apply forwarding logic based on rules
  const forwardingNumbers = getForwardingNumbers(rules.rules, toNumber);
  
  for (const number of forwardingNumbers) {
    const success = await attemptCall(fromNumber, number, tenantId);
    if (success) {
      // Log successful forward
      await logCallForward(fromNumber, toNumber, number, 'success', tenantId);
      
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
  await triggerAnsweringService(fromNumber, toNumber, tenantId);
  
  return new Response(
    JSON.stringify({ 
      success: true, 
      forwardedTo: 'answering-service',
      message: 'Call handled by answering service'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function getForwardingRules(params: any) {
  const { tenantId, userId } = params;
  
  const { data, error } = await supabase
    .from('call_forwarding_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) throw error;

  return new Response(
    JSON.stringify({ rules: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function getForwardingNumbers(rules: any, originalNumber: string): string[] {
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentDay = currentTime.getDay(); // 0 = Sunday
  
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
    const areaCode = originalNumber.substring(0, 3);
    const geoRule = rules.geographicRouting[areaCode];
    
    if (geoRule) {
      forwardingNumbers = [...geoRule.numbers];
    }
  }
  
  // Default forwarding numbers
  if (forwardingNumbers.length === 0 && rules.defaultNumbers) {
    forwardingNumbers = [...rules.defaultNumbers];
  }
  
  // Apply distribution strategy (round-robin, simultaneous, etc.)
  if (rules.distributionStrategy === 'round-robin') {
    return rotateNumbers(forwardingNumbers);
  } else if (rules.distributionStrategy === 'simultaneous') {
    return forwardingNumbers;
  } else {
    return forwardingNumbers;
  }
}

function rotateNumbers(numbers: string[]): string[] {
  // Simple round-robin implementation
  // In production, this would use persistent storage to track rotation
  const rotated = [...numbers];
  const first = rotated.shift();
  if (first) rotated.push(first);
  return rotated;
}

async function attemptCall(fromNumber: string, toNumber: string, tenantId: string): Promise<boolean> {
  try {
    // Simulate call attempt - in production this would use actual telephony API
    console.log(`Attempting call from ${fromNumber} to ${toNumber}`);
    
    // For demo purposes, randomly succeed/fail
    const success = Math.random() > 0.3;
    
    if (success) {
      await logCallActivity(fromNumber, toNumber, 'forwarded', tenantId);
    }
    
    return success;
  } catch (error) {
    console.error(`Call attempt failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

async function handleDefaultForwarding(fromNumber: string, toNumber: string) {
  // Default behavior when no rules are configured
  await triggerAnsweringService(fromNumber, toNumber, null);
  
  return new Response(
    JSON.stringify({ 
      success: true, 
      forwardedTo: 'answering-service',
      message: 'No forwarding rules configured, using answering service'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function triggerAnsweringService(fromNumber: string, toNumber: string, tenantId: string | null) {
  console.log(`Triggering answering service for call from ${fromNumber} to ${toNumber}`);
  
  // Log the answering service activation
  await logCallActivity(fromNumber, toNumber, 'answered_by_service', tenantId);
  
  // Here we would trigger the AI answering service
  // For now, just log the event
}

async function logCallForward(fromNumber: string, originalNumber: string, forwardedNumber: string, status: string, tenantId: string) {
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
}

async function logCallActivity(fromNumber: string, toNumber: string, activity: string, tenantId: string | null) {
  if (!tenantId) return;
  
  await supabase
    .from('call_activity_log')
    .insert({
      tenant_id: tenantId,
      from_number: fromNumber,
      to_number: toNumber,
      activity: activity,
      timestamp: new Date().toISOString()
    });
}