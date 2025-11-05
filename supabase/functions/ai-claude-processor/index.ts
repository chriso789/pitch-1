import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClaudeRequest {
  prompt: string
  model?: string
  system_prompt?: string
  max_tokens?: number
  temperature?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🤖 Claude AI Processor: Starting request')
    
    const { 
      prompt, 
      model = 'anthropic/claude-sonnet-4-5',
      system_prompt = 'You are a helpful AI assistant for a roofing CRM system. Provide clear, actionable advice.',
      max_tokens = 4096,
      temperature = 1
    } = await req.json() as ClaudeRequest

    if (!prompt) {
      throw new Error('Prompt is required')
    }

    console.log(`🤖 Using model: ${model}`)
    console.log(`🤖 Prompt length: ${prompt.length} characters`)

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured')
    }

    // Call Lovable AI Gateway with Claude model
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: system_prompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: max_tokens,
        temperature: temperature
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        console.error('⚠️ Rate limit exceeded')
        return new Response(
          JSON.stringify({ 
            error: 'Rate limit exceeded. Please try again later.',
            rate_limited: true 
          }),
          {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      if (response.status === 402) {
        console.error('⚠️ Payment required')
        return new Response(
          JSON.stringify({ 
            error: 'AI credits exhausted. Please add credits to your Lovable workspace.',
            payment_required: true 
          }),
          {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      const errorText = await response.text()
      console.error('❌ AI gateway error:', response.status, errorText)
      throw new Error(`AI gateway error: ${response.status}`)
    }

    const data = await response.json()
    console.log('✅ Claude AI response received')

    // Extract the response content
    const assistantMessage = data.choices?.[0]?.message?.content || ''
    
    return new Response(
      JSON.stringify({
        success: true,
        response: assistantMessage,
        model: model,
        usage: data.usage || {}
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('❌ Claude processor error:', error)
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
