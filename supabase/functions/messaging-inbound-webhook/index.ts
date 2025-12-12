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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Service role for webhook
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

          // Check for STOP keywords
          const bodyLower = (messageData.body || '').toLowerCase().trim();
          if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(bodyLower)) {
            const { data: provider } = await supabaseClient
              .from('messaging_providers')
              .select('tenant_id')
              .eq('provider_type', 'telnyx_sms')
              .limit(1)
              .single();

            if (provider) {
              const { data: contact } = await supabaseClient
                .from('contacts')
                .select('id')
                .eq('tenant_id', provider.tenant_id)
                .eq('phone', messageData.from)
                .limit(1)
                .single();

              await supabaseClient
                .from('opt_outs')
                .insert({
                  tenant_id: provider.tenant_id,
                  contact_id: contact?.id,
                  channel: 'sms',
                  phone: messageData.from,
                  reason: `Reply: ${bodyLower}`,
                  source: 'reply_stop',
                });
            }
          }
        } else if (event.event_type === 'message.finalized') {
          // Delivery status update from Telnyx
          console.log('Telnyx delivery status:', payload.to?.[0]?.status);
        }
      } else {
        // Not a Telnyx message webhook, might be SendGrid or other JSON
        // Re-process as SendGrid events
        const events = parsed;
        
        // Process each event (SendGrid sends arrays)
        if (Array.isArray(events)) {
          for (const event of events) {
            if (event.event === 'bounce' || event.event === 'dropped') {
              const { data: provider } = await supabaseClient
                .from('messaging_providers')
                .select('tenant_id')
                .eq('provider_type', 'sendgrid_email')
                .limit(1)
                .single();

              if (provider) {
                const { data: contact } = await supabaseClient
                  .from('contacts')
                  .select('id')
                  .eq('tenant_id', provider.tenant_id)
                  .eq('email', event.email)
                  .limit(1)
                  .single();

                await supabaseClient
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
              const { data: provider } = await supabaseClient
                .from('messaging_providers')
                .select('tenant_id')
                .eq('provider_type', 'sendgrid_email')
                .limit(1)
                .single();

              if (provider) {
                const { data: contact } = await supabaseClient
                  .from('contacts')
                  .select('id')
                  .eq('tenant_id', provider.tenant_id)
                  .eq('email', event.email)
                  .limit(1)
                  .single();

                await supabaseClient
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
      };

      // Check for STOP keywords
      const bodyLower = (messageData.body || '').toLowerCase().trim();
      if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(bodyLower)) {
        // Find tenant by phone number
        const { data: provider } = await supabaseClient
          .from('messaging_providers')
          .select('tenant_id')
          .eq('provider_type', 'twilio_sms')
          .limit(1)
          .single();

        if (provider) {
          // Find contact by phone
          const { data: contact } = await supabaseClient
            .from('contacts')
            .select('id')
            .eq('tenant_id', provider.tenant_id)
            .eq('phone', messageData.from)
            .limit(1)
            .single();

          // Add to opt-outs
          await supabaseClient
            .from('opt_outs')
            .insert({
              tenant_id: provider.tenant_id,
              contact_id: contact?.id,
              channel: 'sms',
              phone: messageData.from,
              reason: `Reply: ${bodyLower}`,
              source: 'reply_stop',
            });
        }
      }
    }

    // Store inbound message (for SMS) and update thread
    if (messageData && messageData.type === 'sms') {
      const providerType = messageData.provider === 'telnyx' ? 'telnyx_sms' : 'twilio_sms';
      
      // Find tenant - first try messaging_providers, then fall back to finding by phone
      let tenantId: string | null = null;
      let contactId: string | null = null;

      const { data: provider } = await supabaseClient
        .from('messaging_providers')
        .select('tenant_id')
        .eq('provider_type', providerType)
        .limit(1)
        .single();

      if (provider) {
        tenantId = provider.tenant_id;
      } else {
        // Fallback: find tenant by matching phone number in sms_threads
        const { data: thread } = await supabaseClient
          .from('sms_threads')
          .select('tenant_id, contact_id')
          .eq('phone_number', messageData.from)
          .limit(1)
          .single();
        
        if (thread) {
          tenantId = thread.tenant_id;
          contactId = thread.contact_id;
        }
      }

      if (tenantId) {
        // Find contact by phone if not already found
        if (!contactId) {
          const { data: contact } = await supabaseClient
            .from('contacts')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', messageData.from)
            .limit(1)
            .single();
          
          contactId = contact?.id || null;
        }

        // Store in inbound_messages for legacy
        await supabaseClient
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

        // Find or create SMS thread
        let threadId: string | null = null;
        
        const { data: existingThread } = await supabaseClient
          .from('sms_threads')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('phone_number', messageData.from)
          .single();

        if (existingThread) {
          threadId = existingThread.id;
          
          // Update thread with new message info
          await supabaseClient
            .from('sms_threads')
            .update({
              last_message_at: new Date().toISOString(),
              last_message_preview: (messageData.body || '').substring(0, 100),
              unread_count: existingThread.unread_count ? existingThread.unread_count + 1 : 1,
            })
            .eq('id', threadId);
        } else {
          // Create new thread for this inbound message
          const { data: newThread } = await supabaseClient
            .from('sms_threads')
            .insert({
              tenant_id: tenantId,
              phone_number: messageData.from,
              contact_id: contactId,
              last_message_at: new Date().toISOString(),
              last_message_preview: (messageData.body || '').substring(0, 100),
              unread_count: 1,
            })
            .select('id')
            .single();

          threadId = newThread?.id || null;
        }

        // Insert message into sms_messages
        if (threadId) {
          await supabaseClient
            .from('sms_messages')
            .insert({
              tenant_id: tenantId,
              thread_id: threadId,
              contact_id: contactId,
              direction: 'inbound',
              from_number: messageData.from,
              to_number: messageData.to,
              body: messageData.body,
              status: 'received',
              provider: messageData.provider || 'twilio',
              provider_message_id: messageData.messageSid,
              sent_at: new Date().toISOString(),
            });
        }

        // Also log to communication_history
        await supabaseClient
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
              provider: messageData.provider || 'twilio',
              provider_message_id: messageData.messageSid,
              thread_id: threadId,
            },
          });

        console.log('Inbound SMS stored:', { 
          from: messageData.from, 
          provider: messageData.provider || 'twilio',
          threadId 
        });
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
