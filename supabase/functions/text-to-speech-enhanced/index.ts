import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text, voice, provider } = await req.json()

    if (!text) {
      throw new Error('Text is required')
    }

    // Try ElevenLabs first if API key is available
    const elevenLabsApiKey = Deno.env.get('ELEVEN_LABS_API_KEY')
    
    if (provider === 'elevenlabs' && elevenLabsApiKey) {
      console.log('Using ElevenLabs TTS')
      
      // Voice IDs for ElevenLabs
      const voiceMap: Record<string, string> = {
        'alloy': '9BWtsMINqrJLrRacOk9x', // Aria
        'echo': 'CwhRBWXzGAHq8TQ4Fs17', // Roger
        'fable': 'EXAVITQu4vr4xnSDxMaL', // Sarah
        'onyx': 'TX3LPaxmHKxFdv7VOQHJ', // Liam
        'nova': 'pFZP5JQG7iQjIQuC4Bku', // Lily
        'shimmer': 'XB0fDUnXU5powFXDhCwa' // Charlotte
      }

      const voiceId = voiceMap[voice || 'alloy'] || voiceMap['alloy']

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': elevenLabsApiKey
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true
            }
          })
        }
      )

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const base64Audio = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      )

      return new Response(
        JSON.stringify({ audioContent: base64Audio }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Fallback to OpenAI TTS
    console.log('Using OpenAI TTS')
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    
    if (!openaiApiKey) {
      throw new Error('No TTS provider API key configured')
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text,
        voice: voice || 'alloy',
        response_format: 'mp3',
        speed: 1.0
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Failed to generate speech')
    }

    const arrayBuffer = await response.arrayBuffer()
    const base64Audio = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    )

    return new Response(
      JSON.stringify({ audioContent: base64Audio }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('TTS error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
