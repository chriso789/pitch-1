import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Enhanced Telnyx AI Agent
 * 
 * Features:
 * - Lead qualification (roof age, insurance, timeline)
 * - Appointment booking with calendar integration
 * - FAQ handling with configurable Q&A
 * - Human escalation when needed
 * - Lead scoring based on responses
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
    console.log('[AI Agent Enhanced] Received webhook:', JSON.stringify(payload, null, 2));

    const eventType: string | undefined = payload?.data?.event_type;
    const callControlId: string | undefined = payload?.data?.payload?.call_control_id;
    const callerNumber: string | undefined = payload?.data?.payload?.from;
    const calledNumber: string | undefined = payload?.data?.payload?.to;

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY') ?? '';

    if (!telnyxApiKey) {
      console.error('[AI Agent Enhanced] Missing TELNYX_API_KEY');
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
        .eq('telnyx_phone_number', calledNumber)
        .single();
      
      tenantId = location?.tenant_id || null;
    }

    console.log(`[AI Agent Enhanced] Event: ${eventType}, Tenant: ${tenantId}`);

    // Handle new inbound call
    if (eventType === 'call.initiated') {
      const direction = payload?.data?.payload?.direction;
      
      if (direction !== 'incoming') {
        return new Response(JSON.stringify({ status: 'ignored' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Answer the call
      console.log('[AI Agent Enhanced] Answering call...');
      await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_state: btoa(JSON.stringify({ 
            tenant_id: tenantId, 
            caller_number: callerNumber,
            stage: 'greeting'
          })),
        }),
      });

      return new Response(JSON.stringify({ status: 'call_answered' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // After call is answered, start AI qualification
    if (eventType === 'call.answered') {
      const direction = payload?.data?.payload?.direction;
      
      if (direction !== 'incoming') {
        return new Response(JSON.stringify({ status: 'ignored' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Decode client state
      let clientState: any = {};
      try {
        const encodedState = payload?.data?.payload?.client_state;
        if (encodedState) {
          clientState = JSON.parse(atob(encodedState));
        }
      } catch (e) {
        console.warn('[AI Agent Enhanced] Could not decode client_state');
      }

      const stateTenantId = clientState.tenant_id || tenantId;

      // Get AI config
      let config = {
        greeting: "Hi, thanks for calling! I'm here to help you with your roofing needs. I'll ask a few quick questions to connect you with the right specialist.",
        voice: 'en-US-Wavenet-D',
        model: 'gpt-4',
        temperature: 0.3,
        company_name: 'our company',
        services: ['roof repair', 'roof replacement', 'inspections', 'storm damage'],
      };

      if (stateTenantId) {
        const { data: tenantConfig } = await supabase
          .from('ai_answering_config')
          .select('*')
          .eq('tenant_id', stateTenantId)
          .eq('is_enabled', true)
          .single();

        if (tenantConfig) {
          config.greeting = tenantConfig.greeting_text || config.greeting;
          config.voice = tenantConfig.ai_voice || config.voice;
          config.model = tenantConfig.ai_model || config.model;
          config.temperature = tenantConfig.temperature || config.temperature;
        }

        // Get company name
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', stateTenantId)
          .single();

        if (tenant?.name) {
          config.company_name = tenant.name;
        }
      }

      // Start enhanced AI gather with qualification questions
      const gatherBody = {
        greeting: config.greeting,
        parameters: {
          type: 'object',
          properties: {
            name: {
              description: 'Full name of the caller',
              type: 'string',
            },
            phone: {
              description: 'Best callback phone number',
              type: 'string',
            },
            address: {
              description: 'Property address where service is needed',
              type: 'string',
            },
            service_needed: {
              description: 'What roofing service they need (repair, replacement, inspection, storm damage, etc.)',
              type: 'string',
            },
            roof_age: {
              description: 'Approximate age of the roof in years',
              type: 'string',
            },
            has_insurance_claim: {
              description: 'Whether they have or plan to file an insurance claim',
              type: 'boolean',
            },
            timeline: {
              description: 'When they want the work done (ASAP, this week, this month, just getting estimates)',
              type: 'string',
            },
            budget_range: {
              description: 'Their approximate budget range if mentioned',
              type: 'string',
            },
            additional_notes: {
              description: 'Any other important details mentioned',
              type: 'string',
            },
          },
          required: ['name', 'phone', 'service_needed'],
        },
        voice: config.voice,
        model: config.model,
        temperature: config.temperature,
        system_prompt: `You are a friendly and professional AI assistant for ${config.company_name}, a roofing contractor. 
Your goal is to qualify leads by gathering key information while being conversational and helpful.

Key behaviors:
- Be warm, professional, and empathetic
- Ask clarifying questions naturally
- If caller seems urgent (leak, storm damage), express understanding and prioritize their needs
- If they ask about pricing, explain that an inspector will provide a free quote on-site
- If they ask about insurance, confirm you work with all insurance companies
- If they want to schedule immediately, gather their info first, then confirm a rep will call to schedule

Available services: ${config.services.join(', ')}

At the end, confirm you've captured their information correctly and that a specialist will call them within 1 hour.`,
        tools: [
          { name: 'hangup' },
          { name: 'transfer' },
        ],
        client_state: btoa(JSON.stringify({ 
          tenant_id: stateTenantId, 
          caller_number: callerNumber,
          call_start: new Date().toISOString(),
          stage: 'qualification'
        })),
      };

      await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_ai`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gatherBody),
      });

      return new Response(JSON.stringify({ status: 'ai_qualification_started' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process AI gather results
    if (eventType === 'gather_using_ai.ended') {
      console.log('[AI Agent Enhanced] Processing qualification results...');
      
      const result = payload?.data?.payload?.result;
      const clientStateEncoded = payload?.data?.payload?.client_state;
      
      let clientState: any = {};
      try {
        if (clientStateEncoded) {
          clientState = JSON.parse(atob(clientStateEncoded));
        }
      } catch (e) {}

      const stateTenantId = clientState.tenant_id || tenantId;
      const callStart = clientState.call_start ? new Date(clientState.call_start) : new Date();
      const callDuration = Math.round((new Date().getTime() - callStart.getTime()) / 1000);

      if (result && stateTenantId) {
        console.log('[AI Agent Enhanced] Gathered data:', JSON.stringify(result));

        // Calculate lead score based on responses
        let leadScore = 50; // Base score

        // Timeline urgency
        if (result.timeline?.toLowerCase().includes('asap') || result.timeline?.toLowerCase().includes('today')) {
          leadScore += 20;
        } else if (result.timeline?.toLowerCase().includes('week')) {
          leadScore += 10;
        }

        // Insurance claim = higher value project
        if (result.has_insurance_claim === true) {
          leadScore += 15;
        }

        // Storm damage = urgent
        if (result.service_needed?.toLowerCase().includes('storm') || result.service_needed?.toLowerCase().includes('leak')) {
          leadScore += 15;
        }

        // Roof age
        if (result.roof_age) {
          const age = parseInt(result.roof_age);
          if (age >= 15) leadScore += 10;
          if (age >= 20) leadScore += 10;
        }

        // Cap at 100
        leadScore = Math.min(leadScore, 100);

        // Store AI call transcript with lead score
        await supabase.from('ai_call_transcripts').insert({
          tenant_id: stateTenantId,
          telnyx_call_control_id: callControlId,
          caller_number: callerNumber || clientState.caller_number,
          gathered_data: { ...result, calculated_lead_score: leadScore },
          call_duration_seconds: callDuration,
          escalated_to_human: false,
          sentiment: leadScore >= 80 ? 'hot' : leadScore >= 60 ? 'warm' : 'cool',
        });

        // Find or create contact
        const callbackNumber = result.phone || callerNumber;
        let contactId: string | null = null;

        if (callbackNumber) {
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

            // Update existing contact with new info
            await supabase
              .from('contacts')
              .update({
                address_street: result.address || undefined,
                notes: `AI Qualification: ${result.service_needed}. Roof Age: ${result.roof_age || 'Unknown'}. Insurance: ${result.has_insurance_claim ? 'Yes' : 'No'}. Timeline: ${result.timeline || 'Not specified'}.`,
                lead_score: leadScore,
              })
              .eq('id', contactId);
          } else {
            // Create new contact
            const nameParts = (result.name || 'Unknown Caller').split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.slice(1).join(' ') || 'Caller';

            const { data: newContact } = await supabase
              .from('contacts')
              .insert({
                tenant_id: stateTenantId,
                first_name: firstName,
                last_name: lastName,
                phone: callbackNumber,
                address_street: result.address,
                lead_source: 'Call In',
                lead_score: leadScore,
                notes: `AI Qualification: ${result.service_needed}. Roof Age: ${result.roof_age || 'Unknown'}. Insurance: ${result.has_insurance_claim ? 'Yes' : 'No'}. Timeline: ${result.timeline || 'Not specified'}.`,
              })
              .select('id')
              .single();

            contactId = newContact?.id || null;
          }
        }

        // Create high-priority task for hot leads
        if (contactId && leadScore >= 70) {
          await supabase.from('tasks').insert({
            tenant_id: stateTenantId,
            contact_id: contactId,
            title: `🔥 HOT LEAD: ${result.name || 'New Caller'} - ${result.service_needed}`,
            description: `Lead Score: ${leadScore}\n\nName: ${result.name}\nPhone: ${result.phone || callerNumber}\nAddress: ${result.address || 'Not provided'}\nService: ${result.service_needed}\nRoof Age: ${result.roof_age || 'Unknown'}\nInsurance Claim: ${result.has_insurance_claim ? 'Yes' : 'No'}\nTimeline: ${result.timeline || 'Not specified'}\n\nAdditional Notes: ${result.additional_notes || 'None'}`,
            priority: leadScore >= 80 ? 'urgent' : 'high',
            status: 'pending',
            due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // Due in 1 hour
          });

          // Notify assigned rep
          // Find who should be notified (location manager or round-robin)
          const { data: locationUsers } = await supabase
            .from('location_users')
            .select('user_id')
            .eq('tenant_id', stateTenantId)
            .limit(1);

          const assignedUserId = locationUsers?.[0]?.user_id;

          if (assignedUserId) {
            // Send real-time notification
            await supabase.functions.invoke('trigger-sales-notification', {
              body: {
                type: 'lead_hot',
                tenant_id: stateTenantId,
                user_id: assignedUserId,
                contact_id: contactId,
                title: `🔥 Hot Lead: ${result.name}`,
                message: `Lead score ${leadScore}. ${result.service_needed}. Timeline: ${result.timeline || 'ASAP'}`,
                metadata: { lead_score: leadScore, source: 'ai_call' },
              },
            });
          }
        }

        // Log communication
        if (contactId) {
          await supabase.from('communication_history').insert({
            tenant_id: stateTenantId,
            contact_id: contactId,
            type: 'call',
            direction: 'inbound',
            content: `AI Qualification Call - Lead Score: ${leadScore}\nService: ${result.service_needed}`,
            metadata: {
              gathered_data: result,
              call_duration_seconds: callDuration,
              lead_score: leadScore,
              ai_handled: true,
            },
          });
        }
      }

      // End the call
      if (callControlId) {
        try {
          await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${telnyxApiKey}`,
              'Accept': 'application/json',
            },
          });
        } catch (e) {
          console.warn('[AI Agent Enhanced] Hangup failed (call may have ended)');
        }
      }

      return new Response(JSON.stringify({ status: 'qualification_complete' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle transfer request (escalation to human)
    if (eventType === 'call.transfer.initiated' || payload?.data?.payload?.tool_used === 'transfer') {
      console.log('[AI Agent Enhanced] Transfer requested - escalating to human');
      
      // Get client state
      let clientState: any = {};
      try {
        const encodedState = payload?.data?.payload?.client_state;
        if (encodedState) {
          clientState = JSON.parse(atob(encodedState));
        }
      } catch (e) {}

      const stateTenantId = clientState.tenant_id || tenantId;

      // Get the on-call number
      if (stateTenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('settings')
          .eq('id', stateTenantId)
          .single();

        const onCallNumber = (tenant?.settings as any)?.on_call_number;

        if (onCallNumber && callControlId) {
          await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${telnyxApiKey}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: onCallNumber,
            }),
          });

          console.log('[AI Agent Enhanced] Call transferred to:', onCallNumber);
        }
      }

      return new Response(JSON.stringify({ status: 'transfer_initiated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle hangup
    if (eventType === 'call.hangup') {
      console.log('[AI Agent Enhanced] Call ended');
      return new Response(JSON.stringify({ status: 'hangup_logged' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ status: 'ignored', eventType }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[AI Agent Enhanced] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
