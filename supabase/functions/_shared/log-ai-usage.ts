// Shared helper to log AI gateway usage to ai_usage_metrics.
// Safe to call from any edge function — never throws.

interface CostPerModel { input: number; output: number }

const COST_PER_MILLION: Record<string, CostPerModel> = {
  'anthropic/claude-sonnet-4-5': { input: 3, output: 15 },
  'anthropic/claude-opus-4-1': { input: 15, output: 75 },
  'anthropic/claude-3-7-sonnet': { input: 3, output: 15 },
  'anthropic/claude-3-5-haiku': { input: 0.8, output: 4 },
  'gpt-5': { input: 10, output: 30 },
  'gpt-5-mini': { input: 0.15, output: 0.6 },
  'gpt-5-nano': { input: 0.03, output: 0.12 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1-2025-04-14': { input: 5, output: 15 },
  'gpt-4.1-mini-2025-04-14': { input: 0.4, output: 1.6 },
  'google/gemini-2.5-pro': { input: 1.25, output: 5 },
  'google/gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'google/gemini-2.5-flash-lite': { input: 0.015, output: 0.06 },
  'google/gemini-3-flash-preview': { input: 0.075, output: 0.3 },
};

function estimateCost(model: string, prompt: number, completion: number): number {
  const c = COST_PER_MILLION[model] || { input: 0, output: 0 };
  return (prompt / 1_000_000) * c.input + (completion / 1_000_000) * c.output;
}

export interface LogAIUsageParams {
  supabase: any;
  tenantId?: string | null;
  userId?: string | null;
  provider: 'claude' | 'openai' | 'lovable-ai' | string;
  model: string;
  feature: string;
  promptTokens?: number;
  completionTokens?: number;
  responseTimeMs: number;
  status: 'success' | 'error' | 'rate_limited' | 'payment_required';
  errorMessage?: string;
  endpoint?: string;
  requestId?: string;
}

export async function logAIUsage(p: LogAIUsageParams): Promise<void> {
  try {
    const prompt = p.promptTokens || 0;
    const completion = p.completionTokens || 0;
    const total = prompt + completion;
    await p.supabase.from('ai_usage_metrics').insert({
      tenant_id: p.tenantId || null,
      user_id: p.userId || null,
      provider: p.provider,
      model: p.model,
      feature: p.feature,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      response_time_ms: Math.round(p.responseTimeMs),
      status: p.status,
      error_message: p.errorMessage || null,
      estimated_cost_usd: estimateCost(p.model, prompt, completion),
      request_id: p.requestId || null,
      endpoint: p.endpoint || null,
    });
  } catch (e) {
    console.error('[logAIUsage] failed (non-fatal):', e);
  }
}

/** Extract tenant_id from auth header. Returns { userId, tenantId } or nulls. */
export async function resolveAuthIdentity(supabase: any, authHeader: string | null) {
  if (!authHeader) return { userId: null, tenantId: null };
  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return { userId: null, tenantId: null };
    const { data: profile } = await supabase
      .from('profiles').select('tenant_id').eq('id', user.id).single();
    return { userId: user.id, tenantId: profile?.tenant_id || null };
  } catch {
    return { userId: null, tenantId: null };
  }
}
