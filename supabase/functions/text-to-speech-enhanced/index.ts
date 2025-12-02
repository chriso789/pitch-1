import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Rate limit (20/hour)
    const { data: rateLimit } = await supabase.rpc('check_rate_limit', {
      p_user_id: user.id, p_resource: 'text_to_speech', p_limit: 20, p_window_minutes: 60
    });
    if (rateLimit && !rateLimit.allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), 
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { text, voice, provider } = await req.json();
    if (!text) throw new Error('Text is required');
    if (text.length > 5000) throw new Error('Text too long (max 5000 chars)');

    const elevenLabsApiKey = Deno.env.get('ELEVEN_LABS_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (provider === 'elevenlabs' && elevenLabsApiKey) {
      const voiceMap: Record<string, string> = {
        'alloy': '9BWtsMINqrJLrRacOk9x', 'echo': 'CwhRBWXzGAHq8TQ4Fs17',
        'fable': 'EXAVITQu4vr4xnSDxMaL', 'onyx': 'TX3LPaxmHKxFdv7VOQHJ',
        'nova': 'pFZP5JQG7iQjIQuC4Bku', 'shimmer': 'XB0fDUnXU5powFXDhCwa'
      };
      const voiceId = voiceMap[voice || 'alloy'] || voiceMap['alloy'];

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': elevenLabsApiKey },
        body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
      });

      if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return new Response(JSON.stringify({ audioContent: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer))) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!openaiApiKey) throw new Error('No TTS provider configured');

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1-hd', input: text, voice: voice || 'alloy', response_format: 'mp3' })
    });

    if (!response.ok) throw new Error('Failed to generate speech');
    const arrayBuffer = await response.arrayBuffer();
    return new Response(JSON.stringify({ audioContent: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer))) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), 
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
