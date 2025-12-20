import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const contentType = req.headers.get('content-type') || '';
    let messageData: any;
    let isTelnyxWebhook = false;

    // Check if this is a Telnyx webhook (JSON with data.event_type)
    if (contentType.includes('application/json')) {
      const body = await req.text();
      const parsed = JSON.parse(body);
      
      // Telnyx message webhooks have data.event_type starting with 'message.'
      if (parsed.data?.event_type?.startsWith('message.')) {
        isTelnyxWebhook = true;
        const event = parsed.data;
        const payload = event.payload;
        
        console.log('Telnyx message webhook:', event.event_type);
        
        if (event.event_type === 'message.received') {
          // Inbound SMS from Telnyx
          messageData = {
            from: payload.from?.phone_number,
            to: payload.to?.[0]?.phone_number,
            body: payload.text,
            messageSid: payload.id,
            type: 'sms',
            provider: 'telnyx',
          };

          // Route inbound message by looking up destination phone number
          const routing = await routeInboundMessage(supabaseClient, messageData.to);
          
          console.log('Inbound routing result:', routing);

          // Check for STOP keywords
          const bodyLower = (messageData.body || '').toLowerCase().trim();
          if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(bodyLower)) {
            if (routing.tenantId) {
              const { data: contact } = await supabaseClient
                .from('contacts')
                .select('id')
                .eq('tenant_id', routing.tenantId)
                .eq('phone', messageData.from)
                .limit(1)
                .single();

              await supabaseClient
                .from('opt_outs')
                .insert({
                  tenant_id: routing.tenantId,
                  contact_id: contact?.id,
                  channel: 'sms',
                  phone: messageData.from,
                  reason: `Reply: ${bodyLower}`,
                  source: 'reply_stop',
                });
            }
          }

          // Process the inbound message with location awareness
          if (routing.tenantId) {
            await processInboundSMS(supabaseClient, messageData, routing);
          }
        } else if (event.event_type === 'message.finalized') {
          console.log('Telnyx delivery status:', payload.to?.[0]?.status);
        }
      } else {
        // Not a Telnyx message webhook, might be SendGrid or other JSON
        const events = parsed;
        
        // Process each event (SendGrid sends arrays)
        if (Array.isArray(events)) {
          for (const event of events) {
            await processSendGridEvent(supabaseClient, event);
          }
        }
      }
    }

    // Handle Twilio webhook (form-urlencoded)
    if (!isTelnyxWebhook && contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      messageData = {
        from: formData.get('From'),
        to: formData.get('To'),
        body: formData.get('Body'),
        messageSid: formData.get('MessageSid'),
        type: 'sms',
        provider: 'twilio',
      };

      // Route inbound message
      const routing = await routeInboundMessage(supabaseClient, messageData.to);

      // Check for STOP keywords
      const bodyLower = (messageData.body || '').toLowerCase().trim();
      if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(bodyLower)) {
        if (routing.tenantId) {
          const { data: contact } = await supabaseClient
            .from('contacts')
            .select('id')
            .eq('tenant_id', routing.tenantId)
            .eq('phone', messageData.from)
            .limit(1)
            .single();

          await supabaseClient
            .from('opt_outs')
            .insert({
              tenant_id: routing.tenantId,
              contact_id: contact?.id,
              channel: 'sms',
              phone: messageData.from,
              reason: `Reply: ${bodyLower}`,
              source: 'reply_stop',
            });
        }
      }

      // Process the inbound message with location awareness
      if (routing.tenantId) {
        await processInboundSMS(supabaseClient, messageData, routing);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in messaging-inbound-webhook:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

interface RoutingResult {
  tenantId: string | null;
  locationId: string | null;
  locationName: string | null;
  assignedReps: string[];
}

async function routeInboundMessage(supabase: any, toNumber: string): Promise<RoutingResult> {
  const cleanedPhone = toNumber?.replace(/[^\d+]/g, '') || '';
  
  console.log('Routing inbound for destination:', cleanedPhone);

  // 1. Look up location by telnyx_phone_number
  const { data: location } = await supabase
    .from('locations')
    .select('id, name, tenant_id, manager_id, telnyx_phone_number')
    .or(`telnyx_phone_number.eq.${cleanedPhone},telnyx_phone_number.eq.+${cleanedPhone.replace(/^\+/, '')}`)
    .single();

  if (location) {
    console.log('Found location by phone number:', location.name);
    
    // Get assigned reps for this location
    const { data: assignments } = await supabase
      .from('user_location_assignments')
      .select('user_id')
      .eq('location_id', location.id);

    const assignedReps = assignments?.map((a: any) => a.user_id) || [];
    if (location.manager_id && !assignedReps.includes(location.manager_id)) {
      assignedReps.unshift(location.manager_id);
    }

    return {
      tenantId: location.tenant_id,
      locationId: location.id,
      locationName: location.name,
      assignedReps,
    };
  }

  // 2. Fall back to communication_preferences
  const { data: prefs } = await supabase
    .from('communication_preferences')
    .select('tenant_id')
    .or(`sms_from_number.eq.${cleanedPhone},sms_from_number.eq.+${cleanedPhone.replace(/^\+/, '')}`)
    .single();

  if (prefs) {
    return {
      tenantId: prefs.tenant_id,
      locationId: null,
      locationName: null,
      assignedReps: [],
    };
  }

  // 3. Fall back to messaging_providers
  const { data: provider } = await supabase
    .from('messaging_providers')
    .select('tenant_id')
    .eq('provider_type', 'telnyx_sms')
    .limit(1)
    .single();

  return {
    tenantId: provider?.tenant_id || null,
    locationId: null,
    locationName: null,
    assignedReps: [],
  };
}

async function processInboundSMS(supabase: any, messageData: any, routing: RoutingResult) {
  const { tenantId, locationId, assignedReps } = routing;

  // Find contact by phone
  let contactId: string | null = null;
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .or(`phone.eq.${messageData.from},phone.eq.+${messageData.from?.replace(/^\+/, '')}`)
    .limit(1)
    .single();
  
  contactId = contact?.id || null;

  // Store in inbound_messages for legacy
  await supabase
    .from('inbound_messages')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      message_type: 'sms',
      from_address: messageData.from,
      to_address: messageData.to,
      body: messageData.body,
      provider_message_id: messageData.messageSid,
      received_at: new Date().toISOString(),
    });

  // Find or create SMS thread with location awareness
  let threadId: string | null = null;
  
  const { data: existingThread } = await supabase
    .from('sms_threads')
    .select('id, unread_count')
    .eq('tenant_id', tenantId)
    .eq('phone_number', messageData.from)
    .single();

  if (existingThread) {
    threadId = existingThread.id;
    
    // Update thread with new message info and location
    await supabase
      .from('sms_threads')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: (messageData.body || '').substring(0, 100),
        unread_count: (existingThread.unread_count || 0) + 1,
        location_id: locationId, // Update location if we have it
      })
      .eq('id', threadId);
  } else {
    // Create new thread with location
    const { data: newThread } = await supabase
      .from('sms_threads')
      .insert({
        tenant_id: tenantId,
        phone_number: messageData.from,
        contact_id: contactId,
        location_id: locationId,
        last_message_at: new Date().toISOString(),
        last_message_preview: (messageData.body || '').substring(0, 100),
        unread_count: 1,
      })
      .select('id')
      .single();

    threadId = newThread?.id || null;
  }

  // Insert message into sms_messages with location
  if (threadId) {
    await supabase
      .from('sms_messages')
      .insert({
        tenant_id: tenantId,
        thread_id: threadId,
        contact_id: contactId,
        location_id: locationId,
        direction: 'inbound',
        from_number: messageData.from,
        to_number: messageData.to,
        body: messageData.body,
        status: 'received',
        provider: messageData.provider || 'telnyx',
        provider_message_id: messageData.messageSid,
        sent_at: new Date().toISOString(),
      });
  }

  // Log to communication_history with location
  await supabase
    .from('communication_history')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      type: 'sms',
      direction: 'inbound',
      content: messageData.body,
      phone_number: messageData.from,
      status: 'received',
      metadata: {
        provider: messageData.provider || 'telnyx',
        provider_message_id: messageData.messageSid,
        thread_id: threadId,
        location_id: locationId,
      },
    });

  // Send realtime notification to assigned reps
  if (assignedReps.length > 0) {
    console.log('Notifying assigned reps:', assignedReps);
    // Could broadcast via Supabase Realtime channel here
  }

  console.log('Inbound SMS stored:', { 
    from: messageData.from, 
    provider: messageData.provider,
    threadId,
    locationId,
    assignedReps: assignedReps.length
  });
}

async function processSendGridEvent(supabase: any, event: any) {
  if (event.event === 'bounce' || event.event === 'dropped') {
    const { data: provider } = await supabase
      .from('messaging_providers')
      .select('tenant_id')
      .eq('provider_type', 'sendgrid_email')
      .limit(1)
      .single();

    if (provider) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', provider.tenant_id)
        .eq('email', event.email)
        .limit(1)
        .single();

      await supabase
        .from('opt_outs')
        .insert({
          tenant_id: provider.tenant_id,
          contact_id: contact?.id,
          channel: 'email',
          email: event.email,
          reason: event.reason || 'Bounce',
          source: 'bounce',
        });
    }
  }

  if (event.event === 'unsubscribe' || event.event === 'spamreport') {
    const { data: provider } = await supabase
      .from('messaging_providers')
      .select('tenant_id')
      .eq('provider_type', 'sendgrid_email')
      .limit(1)
      .single();

    if (provider) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', provider.tenant_id)
        .eq('email', event.email)
        .limit(1)
        .single();

      await supabase
        .from('opt_outs')
        .insert({
          tenant_id: provider.tenant_id,
          contact_id: contact?.id,
          channel: 'email',
          email: event.email,
          reason: event.event,
          source: event.event === 'spamreport' ? 'complaint' : 'user_request',
        });
    }
  }
}
