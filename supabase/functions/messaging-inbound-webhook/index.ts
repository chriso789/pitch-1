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

    // Handle Twilio webhook (form-urlencoded)
    if (contentType.includes('application/x-www-form-urlencoded')) {
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
    // Handle SendGrid webhook (JSON)
    else if (contentType.includes('application/json')) {
      const events = await req.json();
      
      // Process each event
      for (const event of events) {
        if (event.event === 'bounce' || event.event === 'dropped') {
          // Find tenant by email
          const { data: provider } = await supabaseClient
            .from('messaging_providers')
            .select('tenant_id')
            .eq('provider_type', 'sendgrid_email')
            .limit(1)
            .single();

          if (provider) {
            // Find contact by email
            const { data: contact } = await supabaseClient
              .from('contacts')
              .select('id')
              .eq('tenant_id', provider.tenant_id)
              .eq('email', event.email)
              .limit(1)
              .single();

            // Add to opt-outs for bounces
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
          // Find tenant by email
          const { data: provider } = await supabaseClient
            .from('messaging_providers')
            .select('tenant_id')
            .eq('provider_type', 'sendgrid_email')
            .limit(1)
            .single();

          if (provider) {
            // Find contact by email
            const { data: contact } = await supabaseClient
              .from('contacts')
              .select('id')
              .eq('tenant_id', provider.tenant_id)
              .eq('email', event.email)
              .limit(1)
              .single();

            // Add to opt-outs
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

    // Store inbound message (for SMS)
    if (messageData && messageData.type === 'sms') {
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

        await supabaseClient
          .from('inbound_messages')
          .insert({
            tenant_id: provider.tenant_id,
            contact_id: contact?.id,
            message_type: 'sms',
            from_address: messageData.from,
            to_address: messageData.to,
            body: messageData.body,
            provider_message_id: messageData.messageSid,
            received_at: new Date().toISOString(),
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
