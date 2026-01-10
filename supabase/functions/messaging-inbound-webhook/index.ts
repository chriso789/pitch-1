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
        } else if (event.event_type === 'message.finalized' || 
                   event.event_type === 'message.sent' || 
                   event.event_type === 'message.delivery_failed') {
          // Handle delivery status updates
          await handleDeliveryStatusUpdate(supabaseClient, event, payload);
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
  const { tenantId, locationId, assignedReps, locationName } = routing;
  const cleanedFromPhone = messageData.from?.replace(/[^\d+]/g, '') || '';
  const telnyxMessageId = messageData.messageSid;

  console.log(`[SMS Routing] Processing inbound from ${cleanedFromPhone} to location: ${locationName || 'unknown'} (${locationId || 'no location'})`);

  // STEP 1: Check for existing thread with this phone + location to find the right contact
  // This ensures replies go to the same contact we previously messaged
  let contactId: string | null = null;
  let threadId: string | null = null;
  let pipelineEntryId: string | null = null;

  // First, look for an existing thread at THIS LOCATION with this phone number
  if (locationId) {
    const { data: locationThread } = await supabase
      .from('sms_threads')
      .select('id, contact_id, unread_count')
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .or(`phone_number.eq.${cleanedFromPhone},phone_number.eq.+${cleanedFromPhone.replace(/^\+/, '')}`)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    if (locationThread) {
      threadId = locationThread.id;
      contactId = locationThread.contact_id;
      console.log(`[SMS Routing] Found existing thread at location: thread=${threadId}, contact=${contactId}`);
      
      // Update thread
      await supabase
        .from('sms_threads')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: (messageData.body || '').substring(0, 100),
          unread_count: (locationThread.unread_count || 0) + 1,
        })
        .eq('id', threadId);
    }
  }

  // STEP 2: If no thread found at location, look for contact at this location
  if (!contactId && locationId) {
    const { data: locationContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .or(`phone.eq.${cleanedFromPhone},phone.eq.+${cleanedFromPhone.replace(/^\+/, '')}`)
      .limit(1)
      .single();

    if (locationContact) {
      contactId = locationContact.id;
      console.log(`[SMS Routing] Found contact at location: ${contactId}`);
    }
  }

  // STEP 3: Fallback - look for any thread with this phone number (for existing conversations)
  if (!threadId) {
    const { data: anyThread } = await supabase
      .from('sms_threads')
      .select('id, contact_id, unread_count, location_id')
      .eq('tenant_id', tenantId)
      .or(`phone_number.eq.${cleanedFromPhone},phone_number.eq.+${cleanedFromPhone.replace(/^\+/, '')}`)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    if (anyThread) {
      threadId = anyThread.id;
      // Only use contact from existing thread if we don't have one yet
      if (!contactId) {
        contactId = anyThread.contact_id;
      }
      console.log(`[SMS Routing] Found existing thread (any location): thread=${threadId}, contact=${contactId}`);
      
      // Update thread with new location and message
      await supabase
        .from('sms_threads')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: (messageData.body || '').substring(0, 100),
          unread_count: (anyThread.unread_count || 0) + 1,
          location_id: locationId || anyThread.location_id, // Update to new location if we have one
        })
        .eq('id', threadId);
    }
  }

  // STEP 4: If still no contact, look for any contact in tenant with this phone
  if (!contactId) {
    const { data: anyContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(`phone.eq.${cleanedFromPhone},phone.eq.+${cleanedFromPhone.replace(/^\+/, '')}`)
      .limit(1)
      .single();

    if (anyContact) {
      contactId = anyContact.id;
      console.log(`[SMS Routing] Found contact (tenant-wide): ${contactId}`);
    }
  }

  // STEP 5: If STILL no contact found, store in unmatched_inbound instead of creating fake leads
  if (!contactId) {
    console.log(`[SMS Routing] ⚠️ No contact found for ${cleanedFromPhone}, storing in unmatched_inbound`);
    
    await supabase
      .from('unmatched_inbound')
      .insert({
        tenant_id: tenantId,
        location_id: locationId,
        channel: 'sms',
        from_e164: cleanedFromPhone,
        to_e164: messageData.to,
        telnyx_message_id: telnyxMessageId,
        body: messageData.body,
        raw_payload: {
          provider: messageData.provider || 'telnyx',
          original_from: messageData.from,
          original_to: messageData.to,
        },
        occurred_at: new Date().toISOString(),
        state: 'open',
      });

    // Still store in inbound_messages for audit trail
    await supabase
      .from('inbound_messages')
      .insert({
        tenant_id: tenantId,
        contact_id: null,
        message_type: 'sms',
        from_address: messageData.from,
        to_address: messageData.to,
        body: messageData.body,
        provider_message_id: messageData.messageSid,
        received_at: new Date().toISOString(),
      });

    console.log('[SMS Routing] Unmatched inbound stored for later linking');
    return; // Exit early - no contact to link to
  }

  // STEP 6: Find active pipeline entry for this contact at this location
  if (contactId && locationId) {
    const { data: pipeline } = await supabase
      .from('pipeline_entries')
      .select('id')
      .eq('contact_id', contactId)
      .eq('location_id', locationId)
      .not('status', 'in', '(closed_won,closed_lost,disqualified)')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (pipeline) {
      pipelineEntryId = pipeline.id;
      console.log(`[SMS Routing] Found pipeline entry at location: ${pipelineEntryId}`);
    }
  }

  // Fallback: pipeline entry without location filter
  if (!pipelineEntryId && contactId) {
    const { data: anyPipeline } = await supabase
      .from('pipeline_entries')
      .select('id')
      .eq('contact_id', contactId)
      .not('status', 'in', '(closed_won,closed_lost,disqualified)')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (anyPipeline) {
      pipelineEntryId = anyPipeline.id;
      console.log(`[SMS Routing] Found pipeline entry (any location): ${pipelineEntryId}`);
    }
  }

  console.log(`[SMS Routing] Final routing: contact=${contactId}, thread=${threadId}, pipeline=${pipelineEntryId}, location=${locationId}`);

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

  // Create thread if we still don't have one
  if (!threadId) {
    const { data: newThread } = await supabase
      .from('sms_threads')
      .insert({
        tenant_id: tenantId,
        phone_number: cleanedFromPhone,
        contact_id: contactId,
        location_id: locationId,
        last_message_at: new Date().toISOString(),
        last_message_preview: (messageData.body || '').substring(0, 100),
        unread_count: 1,
      })
      .select('id')
      .single();

    threadId = newThread?.id || null;
    console.log(`[SMS Routing] Created new thread: ${threadId}`);
  }

  // Insert message into sms_messages with location and deduplication
  if (threadId) {
    // Use upsert with ON CONFLICT to prevent duplicate messages from webhook retries
    const { error: smsInsertError } = await supabase
      .from('sms_messages')
      .upsert({
        tenant_id: tenantId,
        thread_id: threadId,
        contact_id: contactId,
        location_id: locationId,
        pipeline_entry_id: pipelineEntryId,
        direction: 'inbound',
        from_number: messageData.from,
        to_number: messageData.to,
        body: messageData.body,
        status: 'received',
        provider: messageData.provider || 'telnyx',
        provider_message_id: messageData.messageSid,
        telnyx_message_id: telnyxMessageId,
        sent_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,telnyx_message_id',
        ignoreDuplicates: true
      });

    if (smsInsertError) {
      // Check if it's a duplicate key error (expected for retries)
      if (smsInsertError.code === '23505') {
        console.log(`[SMS Routing] Duplicate message ignored (webhook retry): ${telnyxMessageId}`);
      } else {
        console.error('[SMS Routing] Error inserting sms_message:', smsInsertError);
      }
    }
  }

  // Log to communication_history with location and pipeline entry
  await supabase
    .from('communication_history')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      pipeline_entry_id: pipelineEntryId,
      type: 'sms',
      direction: 'inbound',
      content: messageData.body,
      phone_number: messageData.from,
      status: 'received',
      metadata: {
        provider: messageData.provider || 'telnyx',
        provider_message_id: messageData.messageSid,
        telnyx_message_id: telnyxMessageId,
        thread_id: threadId,
        location_id: locationId,
        location_name: locationName,
      },
    });

  // Send realtime notification to assigned reps
  if (assignedReps.length > 0) {
    console.log(`[SMS Routing] Notifying ${assignedReps.length} reps for location: ${locationName}`);
    // Could broadcast via Supabase Realtime channel here
  }

  console.log('[SMS Routing] Inbound SMS stored:', { 
    from: messageData.from, 
    provider: messageData.provider,
    threadId,
    contactId,
    pipelineEntryId,
    locationId,
    assignedReps: assignedReps.length
  });
}

async function handleDeliveryStatusUpdate(supabase: any, event: any, payload: any) {
  const messageId = payload.id;
  const telnyxStatus = payload.to?.[0]?.status || event.event_type.replace('message.', '');
  const errorCode = payload.errors?.[0]?.code || payload.to?.[0]?.carrier?.error_code;
  const errorMessage = payload.errors?.[0]?.title || payload.to?.[0]?.carrier?.error_message;
  
  console.log(`[Delivery Status] Processing ${event.event_type} for message ${messageId}`);
  console.log(`[Delivery Status] Telnyx status: ${telnyxStatus}, Error: ${errorCode} - ${errorMessage}`);
  
  // Map Telnyx statuses to our delivery_status
  const statusMap: Record<string, string> = {
    'queued': 'queued',
    'sending': 'sending', 
    'sent': 'sent',
    'delivered': 'delivered',
    'delivery_failed': 'failed',
    'sending_failed': 'failed',
    'finalized': 'delivered', // Telnyx uses finalized for completed delivery
  };
  
  const deliveryStatus = statusMap[telnyxStatus] || telnyxStatus;
  const now = new Date().toISOString();
  
  // Update communication_history by message_id in metadata
  const { data: commRecords, error: commFindError } = await supabase
    .from('communication_history')
    .select('id, tenant_id, metadata')
    .filter('metadata->>message_id', 'eq', messageId);
  
  if (commFindError) {
    console.error('[Delivery Status] Error finding communication_history:', commFindError);
  } else if (commRecords && commRecords.length > 0) {
    for (const record of commRecords) {
      const updatedMetadata = {
        ...record.metadata,
        telnyx_status: telnyxStatus,
        last_status_update: now,
        ...(errorCode && { carrier_error_code: errorCode }),
        ...(errorMessage && { carrier_error_message: errorMessage }),
      };
      
      const { error: updateError } = await supabase
        .from('communication_history')
        .update({
          delivery_status: deliveryStatus,
          delivery_status_updated_at: now,
          carrier_error_code: errorCode || null,
          metadata: updatedMetadata,
        })
        .eq('id', record.id);
      
      if (updateError) {
        console.error(`[Delivery Status] Error updating communication_history ${record.id}:`, updateError);
      } else {
        console.log(`[Delivery Status] Updated communication_history ${record.id} to: ${deliveryStatus}`);
      }
    }
  } else {
    console.log(`[Delivery Status] No communication_history record found for message_id: ${messageId}`);
  }
  
  // Also update sms_messages by provider_message_id
  const { data: smsRecords, error: smsFindError } = await supabase
    .from('sms_messages')
    .select('id, thread_id')
    .eq('provider_message_id', messageId);
  
  if (smsFindError) {
    console.error('[Delivery Status] Error finding sms_messages:', smsFindError);
  } else if (smsRecords && smsRecords.length > 0) {
    for (const record of smsRecords) {
      const { error: updateError } = await supabase
        .from('sms_messages')
        .update({
          delivery_status: deliveryStatus,
          ...(deliveryStatus === 'failed' && { error_message: errorMessage || errorCode }),
        })
        .eq('id', record.id);
      
      if (updateError) {
        console.error(`[Delivery Status] Error updating sms_messages ${record.id}:`, updateError);
      } else {
        console.log(`[Delivery Status] Updated sms_messages ${record.id} to: ${deliveryStatus}`);
      }
    }
  } else {
    console.log(`[Delivery Status] No sms_messages record found for provider_message_id: ${messageId}`);
  }
  
  // Log failures with detailed info
  if (deliveryStatus === 'failed') {
    console.warn(`[Delivery Status] ⚠️ Message ${messageId} FAILED:`, {
      errorCode,
      errorMessage,
      carrier: payload.to?.[0]?.carrier,
      toNumber: payload.to?.[0]?.phone_number,
    });
  }
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
