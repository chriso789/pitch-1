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
  feature?: string
}

interface CostPerModel {
  input: number
  output: number
}

// Estimated costs per 1M tokens (as of 2025)
const COST_PER_MILLION: Record<string, CostPerModel> = {
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-1-20250805': { input: 15, output: 75 },
  'claude-3-7-sonnet-20250219': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs: CostPerModel = COST_PER_MILLION[model] || { input: 0, output: 0 }
  const inputCost = (promptTokens / 1_000_000) * costs.input
  const outputCost = (completionTokens / 1_000_000) * costs.output
  return inputCost + outputCost
}

async function logMetrics(
  supabaseClient: any,
  userId: string,
  model: string,
  feature: string,
  promptTokens: number,
  completionTokens: number,
  responseTimeMs: number,
  status: string,
  errorMessage?: string,
  requestId?: string
) {
  try {
    // Get user's active tenant (supports multi-company switching)
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', userId)
      .single()

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      console.warn('⚠️ No tenant_id found for user, skipping metrics logging')
      return
    }

    const totalTokens = promptTokens + completionTokens
    const estimatedCost = estimateCost(model, promptTokens, completionTokens)

    await supabaseClient.from('ai_usage_metrics').insert({
      tenant_id: profile.tenant_id,
      user_id: userId,
      provider: 'claude',
      model: model,
      feature: feature,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      response_time_ms: responseTimeMs,
      status: status,
      error_message: errorMessage,
      estimated_cost_usd: estimatedCost,
      request_id: requestId,
      endpoint: '/ai-claude-processor',
    })

    console.log('✅ Metrics logged successfully')
  } catch (error) {
    console.error('❌ Failed to log metrics:', error)
    // Don't throw - metrics logging should not break the main functionality
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🤖 Claude AI Processor: Starting request')
    const startTime = Date.now()
    
    // Initialize Supabase client
    const authHeader = req.headers.get('Authorization')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || '' } }
    })

    // Get user from auth header
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    const userId = user?.id
    
    const { 
      prompt, 
      model = 'claude-sonnet-4-5',
      system_prompt = 'You are a helpful AI assistant for a roofing CRM system. Provide clear, actionable advice.',
      max_tokens = 4096,
      temperature = 1,
      feature = 'ai-test'
    } = await req.json() as ClaudeRequest

    if (!prompt) {
      throw new Error('Prompt is required')
    }

    console.log(`🤖 Using model: ${model}`)
    console.log(`🤖 Prompt length: ${prompt.length} characters`)
    console.log(`🤖 Feature: ${feature}`)

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }

    // Call Anthropic API directly
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        system: system_prompt,
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: max_tokens,
        temperature: temperature
      }),
    })

    if (!response.ok) {
      const responseTimeMs = Date.now() - startTime
      
      if (response.status === 429) {
        console.error('⚠️ Rate limit exceeded')
        
        // Log rate limit event
        if (userId) {
          await logMetrics(supabase, userId, model, feature, 0, 0, responseTimeMs, 'rate_limited', 'Rate limit exceeded')
        }
        
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
        
        // Log payment required event
        if (userId) {
          await logMetrics(supabase, userId, model, feature, 0, 0, responseTimeMs, 'payment_required', 'AI credits exhausted')
        }
        
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
      
      // Log error event
      if (userId) {
        await logMetrics(supabase, userId, model, feature, 0, 0, responseTimeMs, 'error', `AI gateway error: ${response.status}`)
      }
      
      throw new Error(`AI gateway error: ${response.status}`)
    }

    const data = await response.json()
    const responseTimeMs = Date.now() - startTime
    console.log('✅ Claude AI response received')
    console.log(`⏱️ Response time: ${responseTimeMs}ms`)

    // Extract the response content and usage (Anthropic API format)
    const assistantMessage = data.content?.[0]?.text || ''
    const usage = data.usage || {}
    const promptTokens = usage.input_tokens || 0
    const completionTokens = usage.output_tokens || 0
    
    console.log(`📊 Token usage - Prompt: ${promptTokens}, Completion: ${completionTokens}, Total: ${promptTokens + completionTokens}`)
    
    // Log successful metrics
    if (userId) {
      await logMetrics(
        supabase,
        userId,
        model,
        feature,
        promptTokens,
        completionTokens,
        responseTimeMs,
        'success',
        undefined,
        data.id
      )
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        response: assistantMessage,
        model: model,
        usage: usage
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('❌ Claude processor error:', error)
    
    // Try to log the error if we have access to user context
    try {
      const authHeader = req.headers.get('Authorization')
      if (authHeader) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')
        
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey, {
            global: { headers: { Authorization: authHeader } }
          })
          
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            const body = await req.json().catch(() => ({}))
            await logMetrics(
              supabase,
              user.id,
              body.model || 'claude-sonnet-4-5',
              body.feature || 'ai-test',
              0,
              0,
              0,
              'error',
              error instanceof Error ? error.message : 'Unknown error'
            )
          }
        }
      }
    } catch (logError) {
      console.error('Failed to log error metrics:', logError)
    }
    
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
