import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { call_id, transcript_text, speaker, timestamp_ms, is_partial, confidence } = await req.json();

    if (!call_id || !transcript_text) {
      throw new Error('Missing required fields: call_id, transcript_text');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get tenant_id from call
    const { data: call } = await supabase
      .from('calls')
      .select('tenant_id')
      .eq('id', call_id)
      .single();

    if (!call) {
      throw new Error('Call not found');
    }

    // Insert transcript
    const { error } = await supabase
      .from('call_transcripts')
      .insert({
        tenant_id: call.tenant_id,
        call_id,
        transcript_text,
        speaker: speaker || 'unknown',
        timestamp_ms: timestamp_ms || 0,
        is_partial: is_partial !== false,
        confidence: confidence || null,
      });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Transcript ingest error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
