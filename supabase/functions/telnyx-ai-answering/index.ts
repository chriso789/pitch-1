import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Telnyx AI Answering Service
 * Handles inbound calls using Telnyx gather_using_ai to collect caller information
 * and store results in the CRM.
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
    const payload = await req.json();
    console.log('[AI Answering] Received webhook:', JSON.stringify(payload, null, 2));

    const eventType: string | undefined = payload?.data?.event_type;
    const callControlId: string | undefined = payload?.data?.payload?.call_control_id;
    const callerNumber: string | undefined = payload?.data?.payload?.from;
    const calledNumber: string | undefined = payload?.data?.payload?.to;

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY') ?? '';

    if (!telnyxApiKey) {
      console.error('[AI Answering] Missing TELNYX_API_KEY');
      return new Response(JSON.stringify({ error: 'Missing API key' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detect tenant from called number
    let tenantId: string | null = null;
    if (calledNumber) {
      const { data: location } = await supabase
        .from('locations')
        .select('tenant_id')
        .eq('telnyx_phone_number', calledNumber.replace('+1', '+1'))
        .single();
      
      tenantId = location?.tenant_id || null;
      
      // Fallback: check communication_preferences
      if (!tenantId) {
        const { data: commPrefs } = await supabase
          .from('communication_preferences')
          .select('tenant_id')
          .eq('sms_from_number', calledNumber)
          .single();
        tenantId = commPrefs?.tenant_id || null;
      }
    }

    console.log(`[AI Answering] Event: ${eventType}, Tenant: ${tenantId}, From: ${callerNumber}`);

    // Handle new inbound call - answer and start AI gather
    if (eventType === 'call.initiated') {
      const direction = payload?.data?.payload?.direction;
      
      // Only handle inbound calls (no client_state = not from power dialer)
      if (direction !== 'incoming') {
        console.log('[AI Answering] Ignoring non-inbound call');
        return new Response(JSON.stringify({ status: 'ignored', reason: 'not inbound' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!callControlId) {
        throw new Error('Missing call_control_id');
      }

      // Get AI answering config for tenant
      let config: any = {
        greeting_text: "Hi, thanks for calling O'Brien Contracting. I'll ask a few questions to better assist you.",
        ai_voice: 'en-US-Wavenet-D',
        ai_model: 'gpt-3.5-turbo',
        temperature: 0.2,
        qualification_questions: null,
      };

      if (tenantId) {
        const { data: tenantConfig } = await supabase
          .from('ai_answering_config')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('is_enabled', true)
          .single();

        if (tenantConfig) {
          config = {
            greeting_text: tenantConfig.greeting_text || config.greeting_text,
            ai_voice: tenantConfig.ai_voice || config.ai_voice,
            ai_model: tenantConfig.ai_model || config.ai_model,
            temperature: tenantConfig.temperature || config.temperature,
            qualification_questions: tenantConfig.qualification_questions || null,
          };
        }
      }

      // 1. Answer the call
      console.log('[AI Answering] Answering call...');
      const answerResponse = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_state: btoa(JSON.stringify({ tenant_id: tenantId, caller_number: callerNumber })),
        }),
      });

      if (!answerResponse.ok) {
        const errorText = await answerResponse.text();
        console.error('[AI Answering] Failed to answer call:', errorText);
        throw new Error(`Failed to answer call: ${errorText}`);
      }

      console.log('[AI Answering] Call answered successfully');

      return new Response(JSON.stringify({ status: 'call_answered', callControlId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // After call is answered, start noise suppression and AI gather
    if (eventType === 'call.answered') {
      const direction = payload?.data?.payload?.direction;
      
      if (direction !== 'incoming') {
        return new Response(JSON.stringify({ status: 'ignored' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!callControlId) {
        throw new Error('Missing call_control_id');
      }

      // Decode client_state to get tenant info
      let clientState: any = {};
      try {
        const encodedState = payload?.data?.payload?.client_state;
        if (encodedState) {
          clientState = JSON.parse(atob(encodedState));
        }
      } catch (e) {
        console.warn('[AI Answering] Could not decode client_state:', e);
      }

      const stateTenantId = clientState.tenant_id || tenantId;

      // Get config
      let config: any = {
        greeting_text: "Hi, thanks for calling. I'll ask a few questions to better assist you.",
        ai_voice: 'en-US-Wavenet-D',
        ai_model: 'gpt-3.5-turbo',
        temperature: 0.2,
        qualification_questions: null,
      };

      if (stateTenantId) {
        const { data: tenantConfig } = await supabase
          .from('ai_answering_config')
          .select('*')
          .eq('tenant_id', stateTenantId)
          .eq('is_enabled', true)
          .single();

        if (tenantConfig) {
          config = {
            greeting_text: tenantConfig.greeting_text || config.greeting_text,
            ai_voice: tenantConfig.ai_voice || config.ai_voice,
            ai_model: tenantConfig.ai_model || config.ai_model,
            temperature: tenantConfig.temperature || config.temperature,
            qualification_questions: tenantConfig.qualification_questions || null,
          };
        }
      }

      // 2. Start noise suppression
      console.log('[AI Answering] Starting noise suppression...');
      try {
        await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/suppression_start`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${telnyxApiKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ direction: 'inbound' }),
        });
      } catch (e) {
        console.warn('[AI Answering] Noise suppression failed (non-critical):', e);
      }

      // 3. Build AI gather parameters from qualification_questions config
      const defaultProperties: Record<string, any> = {
        name: { description: 'Full name of the caller', type: 'string' },
        service: { description: 'Service needed (e.g., roof repair, inspection, replacement, storm damage, estimate)', type: 'string' },
        callback_number: { description: 'Best phone number to reach the caller for a callback', type: 'string' },
        address: { description: 'Property address where service is needed', type: 'string' },
      };
      const defaultRequired = ['name', 'service', 'callback_number'];

      let gatherProperties: Record<string, any> = defaultProperties;
      let gatherRequired: string[] = defaultRequired;

      if (config.qualification_questions && Array.isArray(config.qualification_questions)) {
        gatherProperties = {};
        gatherRequired = [];
        for (const q of config.qualification_questions) {
          if (!q.enabled) continue;
          gatherProperties[q.key] = { description: q.description, type: q.type || 'string' };
          if (q.required) gatherRequired.push(q.key);
        }
        // Ensure at least one property
        if (Object.keys(gatherProperties).length === 0) {
          gatherProperties = defaultProperties;
          gatherRequired = defaultRequired;
        }
      }

      console.log('[AI Answering] Using gather properties:', Object.keys(gatherProperties));

      const gatherBody = {
        greeting: config.greeting_text,
        parameters: {
          type: 'object',
          properties: gatherProperties,
          required: gatherRequired,
        },
        voice: config.ai_voice,
        model: config.ai_model,
        temperature: config.temperature,
        tools: [
          { name: 'hangup' },
        ],
        client_state: btoa(JSON.stringify({ 
          tenant_id: stateTenantId, 
          caller_number: callerNumber,
          call_start: new Date().toISOString(),
        })),
      };

      const gatherResponse = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_ai`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gatherBody),
      });

      if (!gatherResponse.ok) {
        const errorText = await gatherResponse.text();
        console.error('[AI Answering] Failed to start AI gather:', errorText);
        throw new Error(`Failed to start AI gather: ${errorText}`);
      }

      console.log('[AI Answering] AI gather started successfully');

      return new Response(JSON.stringify({ status: 'ai_gather_started' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process AI gather results
    if (eventType === 'gather_using_ai.ended' || eventType === 'ai.gather.result') {
      console.log('[AI Answering] Processing AI gather results...');
      
      const result = payload?.data?.payload?.result || payload?.data?.payload?.input;
      const clientStateEncoded = payload?.data?.payload?.client_state;
      
      let clientState: any = {};
      try {
        if (clientStateEncoded) {
          clientState = JSON.parse(atob(clientStateEncoded));
        }
      } catch (e) {
        console.warn('[AI Answering] Could not decode client_state:', e);
      }

      const stateTenantId = clientState.tenant_id || tenantId;
      const callStart = clientState.call_start ? new Date(clientState.call_start) : new Date();
      const callDuration = Math.round((new Date().getTime() - callStart.getTime()) / 1000);

      if (result && stateTenantId) {
        console.log('[AI Answering] Gathered data:', JSON.stringify(result));

        // Store AI call transcript
        await supabase.from('ai_call_transcripts').insert({
          tenant_id: stateTenantId,
          telnyx_call_control_id: callControlId,
          caller_number: callerNumber || clientState.caller_number,
          gathered_data: result,
          call_duration_seconds: callDuration,
          escalated_to_human: false,
        });

        // Find or create contact
        const callbackNumber = result.callback_number || callerNumber;
        let contactId: string | null = null;

        if (callbackNumber) {
          // Normalize phone number for lookup
          const normalizedPhone = callbackNumber.replace(/\D/g, '').slice(-10);
          
          const { data: existingContact } = await supabase
            .from('contacts')
            .select('id')
            .eq('tenant_id', stateTenantId)
            .or(`phone.ilike.%${normalizedPhone},secondary_phone.ilike.%${normalizedPhone}`)
            .limit(1)
            .single();

          if (existingContact) {
            contactId = existingContact.id;
            console.log('[AI Answering] Found existing contact:', contactId);
          } else {
            // Parse name into first/last
            const nameParts = (result.name || 'Unknown Caller').split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.slice(1).join(' ') || 'Caller';

            // Parse address if provided
            let addressStreet = null;
            let addressCity = null;
            let addressState = null;
            let addressZip = null;

            if (result.address) {
              // Simple address parsing - can be enhanced
              addressStreet = result.address;
            }

            const { data: newContact, error: contactError } = await supabase
              .from('contacts')
              .insert({
                tenant_id: stateTenantId,
                first_name: firstName,
                last_name: lastName,
                phone: callbackNumber,
                address_street: addressStreet,
                lead_source: 'Call In',
                notes: `Service requested: ${result.service || 'Not specified'}. Created via AI Answering Service.`,
              })
              .select('id')
              .single();

            if (contactError) {
              console.error('[AI Answering] Failed to create contact:', contactError);
            } else {
              contactId = newContact?.id;
              console.log('[AI Answering] Created new contact:', contactId);
            }
          }
        }

        // Log to communication_history
        if (contactId) {
          await supabase.from('communication_history').insert({
            tenant_id: stateTenantId,
            contact_id: contactId,
            type: 'call',
            direction: 'inbound',
            content: `AI Answering Service - Service requested: ${result.service || 'Not specified'}`,
            metadata: {
              gathered_data: result,
              call_duration_seconds: callDuration,
              telnyx_call_control_id: callControlId,
              ai_handled: true,
            },
          });

          // Create follow-up task
          await supabase.from('tasks').insert({
            tenant_id: stateTenantId,
            contact_id: contactId,
            title: `Follow up with ${result.name || 'Caller'} - ${result.service || 'Service inquiry'}`,
            description: `AI Answering Service collected the following information:\n\nName: ${result.name || 'Not provided'}\nService: ${result.service || 'Not specified'}\nCallback: ${result.callback_number || callerNumber}\nAddress: ${result.address || 'Not provided'}\n\nCall duration: ${callDuration} seconds`,
            priority: 'high',
            status: 'pending',
            due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // Due in 2 hours
          });

          console.log('[AI Answering] Created follow-up task');
        }
      }

      // Hang up the call after gathering info
      if (callControlId) {
        try {
          await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${telnyxApiKey}`,
              'Accept': 'application/json',
            },
          });
          console.log('[AI Answering] Call ended');
        } catch (e) {
          console.warn('[AI Answering] Failed to hangup (call may have ended):', e);
        }
      }

      return new Response(JSON.stringify({ status: 'ai_gather_result_processed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle call hangup - log completion
    if (eventType === 'call.hangup') {
      console.log('[AI Answering] Call hangup received');
      
      return new Response(JSON.stringify({ status: 'hangup_logged' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Return OK for other events
    return new Response(JSON.stringify({ status: 'ignored', eventType }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[AI Answering] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
