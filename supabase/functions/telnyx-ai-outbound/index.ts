import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Telnyx AI Outbound Calling
 * 
 * Initiates AI-powered outbound calls for:
 * - Lead follow-ups
 * - Appointment confirmations
 * - Post-service surveys
 * - Re-engagement campaigns
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { 
      tenant_id,
      contact_id,
      phone_number,
      call_type,
      script,
      from_number,
      webhook_url
    } = await req.json();

    console.log('[AI Outbound] Initiating call:', { tenant_id, contact_id, call_type });

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY') ?? '';
    
    if (!telnyxApiKey) {
      return new Response(JSON.stringify({ error: 'Missing TELNYX_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!phone_number || !tenant_id) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the tenant's Telnyx connection ID and from number
    let connectionId = Deno.env.get('TELNYX_CONNECTION_ID');
    let callerIdNumber = from_number;

    if (!callerIdNumber) {
      // Get tenant's phone number
      const { data: location } = await supabase
        .from('locations')
        .select('telnyx_phone_number')
        .eq('tenant_id', tenant_id)
        .not('telnyx_phone_number', 'is', null)
        .limit(1)
        .single();

      callerIdNumber = location?.telnyx_phone_number;
    }

    if (!callerIdNumber) {
      return new Response(JSON.stringify({ error: 'No outbound caller ID configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Define AI prompts based on call type
    const callConfigs: Record<string, any> = {
      follow_up: {
        greeting: "Hi, this is an automated call from your roofing company following up on your recent inquiry. I wanted to check if you're still interested in getting a free estimate. Would you like me to help schedule an appointment?",
        objective: "Schedule an appointment or gather updated timeline",
        parameters: {
          still_interested: { type: 'boolean', description: 'Whether they are still interested' },
          preferred_date: { type: 'string', description: 'Preferred appointment date' },
          preferred_time: { type: 'string', description: 'Preferred time (morning, afternoon, evening)' },
          updated_notes: { type: 'string', description: 'Any updated information' },
        },
      },
      appointment_confirmation: {
        greeting: "Hi, this is an automated call to confirm your roofing appointment. I just need to verify a few details. Is this a good time?",
        objective: "Confirm appointment details",
        parameters: {
          confirmed: { type: 'boolean', description: 'Whether they confirm the appointment' },
          reschedule_requested: { type: 'boolean', description: 'Whether they want to reschedule' },
          new_date: { type: 'string', description: 'New date if rescheduling' },
          notes: { type: 'string', description: 'Any special instructions' },
        },
      },
      survey: {
        greeting: "Hi, this is a quick courtesy call to follow up on your recent roofing service. We'd love to hear how everything went. Do you have a minute to share your feedback?",
        objective: "Collect customer satisfaction feedback",
        parameters: {
          satisfaction_rating: { type: 'number', description: 'Rating from 1-10' },
          would_recommend: { type: 'boolean', description: 'Would recommend to others' },
          feedback: { type: 'string', description: 'Any specific feedback or comments' },
          issues: { type: 'string', description: 'Any issues to report' },
        },
      },
      reengagement: {
        greeting: "Hi, this is a call from your roofing company. We noticed it's been a while since we last connected. I wanted to check if you've had any new roofing needs come up, or if there's anything we can help with.",
        objective: "Re-engage cold leads",
        parameters: {
          has_new_needs: { type: 'boolean', description: 'Whether they have new roofing needs' },
          current_status: { type: 'string', description: 'Current status of their roof/project' },
          callback_requested: { type: 'boolean', description: 'Whether they want a callback' },
        },
      },
    };

    const callConfig = callConfigs[call_type] || callConfigs.follow_up;
    const greeting = script || callConfig.greeting;

    // Initiate the outbound call
    const callResponse = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: connectionId,
        to: phone_number,
        from: callerIdNumber,
        webhook_url: webhook_url || `${Deno.env.get('SUPABASE_URL')}/functions/v1/telnyx-ai-agent-enhanced`,
        answering_machine_detection: 'premium',
        client_state: btoa(JSON.stringify({
          tenant_id,
          contact_id,
          call_type,
          is_outbound: true,
          greeting,
          parameters: callConfig.parameters,
        })),
      }),
    });

    if (!callResponse.ok) {
      const error = await callResponse.text();
      console.error('[AI Outbound] Failed to initiate call:', error);
      throw new Error(`Failed to initiate call: ${error}`);
    }

    const callData = await callResponse.json();
    console.log('[AI Outbound] Call initiated:', callData.data?.call_control_id);

    // Log the outbound call attempt
    if (contact_id) {
      await supabase.from('call_logs').insert({
        tenant_id,
        contact_id,
        direction: 'outbound',
        caller_id: callerIdNumber,
        callee_number: phone_number,
        status: 'initiated',
        call_sid: callData.data?.call_control_id,
        metadata: { call_type, ai_driven: true },
      });
    }

    return new Response(JSON.stringify({ 
      success: true,
      call_control_id: callData.data?.call_control_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[AI Outbound] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
