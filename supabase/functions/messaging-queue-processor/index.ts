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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Service role for background processing
    );

    // Fetch pending messages that are ready to send
    const { data: messages, error: fetchError } = await supabaseClient
      .from('message_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .lt('retry_count', supabaseClient.from('message_queue').select('max_retries'))
      .order('scheduled_for', { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;

    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each message
    for (const message of messages || []) {
      try {
        results.processed++;

        // Determine which edge function to call
        const functionName = message.message_type === 'sms' 
          ? 'messaging-send-sms' 
          : 'messaging-send-email';

        // Call the appropriate sending function
        const response = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/${functionName}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messageId: message.id }),
          }
        );

        if (response.ok) {
          results.sent++;
        } else {
          results.failed++;
          const errorText = await response.text();
          results.errors.push(`${message.id}: ${errorText}`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${message.id}: ${error.message}`);
        console.error(`Failed to process message ${message.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in messaging-queue-processor:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
