import { supabase } from "@/integrations/supabase/client";

interface LogAIMetricsParams {
  provider: 'claude' | 'openai' | 'lovable-ai';
  model: string;
  feature: string;
  promptTokens: number;
  completionTokens: number;
  responseTimeMs: number;
  status: 'success' | 'error' | 'rate_limited' | 'payment_required';
  errorMessage?: string;
  requestId?: string;
}

interface CostPerModel {
  input: number;
  output: number;
}

// Estimated costs per 1M tokens (as of 2025)
const COST_PER_MILLION: Record<string, CostPerModel> = {
  // Claude costs (Anthropic)
  'anthropic/claude-sonnet-4-5': { input: 3, output: 15 },
  'anthropic/claude-opus-4-1': { input: 15, output: 75 },
  'anthropic/claude-3-7-sonnet': { input: 3, output: 15 },
  'anthropic/claude-3-5-haiku': { input: 0.8, output: 4 },
  
  // OpenAI costs
  'gpt-5': { input: 10, output: 30 },
  'gpt-5-mini': { input: 0.15, output: 0.6 },
  'gpt-5-nano': { input: 0.03, output: 0.12 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  
  // Lovable AI (uses Gemini pricing)
  'google/gemini-2.5-pro': { input: 1.25, output: 5 },
  'google/gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'google/gemini-2.5-flash-lite': { input: 0.015, output: 0.06 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs: CostPerModel = COST_PER_MILLION[model] || { input: 0, output: 0 };
  
  const inputCost = (promptTokens / 1_000_000) * costs.input;
  const outputCost = (completionTokens / 1_000_000) * costs.output;
  
  return inputCost + outputCost;
}

export async function logAIMetrics(params: LogAIMetricsParams): Promise<void> {
  try {
    // Get current user profile to extract tenant_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) return;

    const totalTokens = params.promptTokens + params.completionTokens;
    const estimatedCost = estimateCost(params.model, params.promptTokens, params.completionTokens);

    await supabase.from('ai_usage_metrics').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      provider: params.provider,
      model: params.model,
      feature: params.feature,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: totalTokens,
      response_time_ms: params.responseTimeMs,
      status: params.status,
      error_message: params.errorMessage,
      estimated_cost_usd: estimatedCost,
      request_id: params.requestId,
      endpoint: window.location.pathname,
    });
  } catch (error) {
    console.error('Failed to log AI metrics:', error);
    // Don't throw - metrics logging should not break the app
  }
}
