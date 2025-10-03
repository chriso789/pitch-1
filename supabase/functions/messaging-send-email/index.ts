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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { messageId } = await req.json();

    // Fetch message from queue
    const { data: message, error: fetchError } = await supabaseClient
      .from('message_queue')
      .select('*, messaging_providers(*)')
      .eq('id', messageId)
      .single();

    if (fetchError) throw fetchError;
    if (!message) throw new Error('Message not found');

    // Update status to sending
    await supabaseClient
      .from('message_queue')
      .update({ status: 'sending' })
      .eq('id', messageId);

    // Get SendGrid credentials from secrets
    const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY');
    const fromEmail = Deno.env.get('SENDGRID_FROM_EMAIL') || 'noreply@pitch.app';
    const fromName = Deno.env.get('SENDGRID_FROM_NAME') || 'PITCH CRM';

    if (!sendgridApiKey) {
      throw new Error('SendGrid API key not configured');
    }

    // Send email via SendGrid
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: message.recipient }],
          subject: message.subject || 'Message from PITCH',
        }],
        from: {
          email: fromEmail,
          name: fromName,
        },
        content: [{
          type: 'text/html',
          value: message.message_body,
        }],
      }),
    });

    if (response.ok || response.status === 202) {
      const messageIdHeader = response.headers.get('x-message-id');
      
      // Update message as sent
      await supabaseClient
        .from('message_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: messageIdHeader,
          metadata: { ...message.metadata, sendgridMessageId: messageIdHeader },
        })
        .eq('id', messageId);

      return new Response(
        JSON.stringify({ success: true, messageId: messageIdHeader }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      const errorData = await response.text();
      
      // Update message as failed
      await supabaseClient
        .from('message_queue')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          error_message: errorData,
          retry_count: message.retry_count + 1,
        })
        .eq('id', messageId);

      throw new Error(errorData || 'Failed to send email');
    }
  } catch (error) {
    console.error('Error in messaging-send-email:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
