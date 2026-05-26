// ============================================
// LOVABLE AI GATEWAY HELPER (with usage tracking)
// ============================================

import { trackUsage, checkUsageLimit } from "./track-usage.ts";

export interface AIResponseResult {
  text: string;
  raw: unknown;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIRequestOptions {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  // ---- usage tracking context (all optional) ----
  tenantId?: string | null;
  userId?: string | null;
  featureArea?: string | null;      // e.g. "estimate_generation", "ai_measurement"
  edgeFunction?: string | null;     // caller function name
  requestId?: string | null;
  /** Provider label for usage_events. Defaults to "lovable-ai". */
  provider?: string;
  /** If true and tenantId provided, call checkUsageLimit(ai_generation) first; block on deny. */
  enforceLimit?: boolean;
}

/**
 * Generate AI response using Lovable AI Gateway, with automatic usage tracking.
 * - Logs one ai_generation event (quantity=1) per call.
 * - Logs ai_tokens_input + ai_tokens_output events with token counts.
 * - Logs blocked_limit attempt if checkUsageLimit denies.
 */
export async function generateAIResponse(opts: AIRequestOptions): Promise<AIResponseResult> {
  const {
    system,
    user,
    model = "google/gemini-3-flash-preview",
    temperature = 0.4,
    tenantId = null,
    userId = null,
    featureArea = null,
    edgeFunction = null,
    requestId = null,
    provider = "lovable-ai",
    enforceLimit = false,
  } = opts;

  const startedAt = Date.now();

  const baseMeta = {
    model,
    feature_name: featureArea,
    edge_function: edgeFunction,
    request_id: requestId,
  };

  // Optional pre-flight quota gate
  if (enforceLimit && tenantId) {
    try {
      const gate = await checkUsageLimit({ tenantId, eventType: "ai_generation", quantity: 1 });
      if (gate && gate.allowed === false) {
        trackUsage({
          tenantId, userId, provider, eventType: "ai_generation",
          featureArea, edgeFunction, requestId, status: "blocked_limit",
          metadata: { ...baseMeta, reason: gate.reason, current_usage: gate.current_usage, limit: gate.limit },
        });
        throw new Error(`ai_blocked_limit: ${gate.reason ?? "monthly_limit_reached"}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("ai_blocked_limit")) throw e;
      // limit-check infra failure — fail open
    }
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    trackUsage({
      tenantId, userId, provider, eventType: "ai_generation",
      featureArea, edgeFunction, requestId, status: "error",
      metadata: { ...baseMeta, error: "missing_api_key" },
    });
    throw new Error("Missing LOVABLE_API_KEY - ensure Cloud is enabled");
  }

  console.log(`[AI] ${edgeFunction ?? "?"} → ${model} (feature=${featureArea ?? "?"})`);

  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
      }),
    });
  } catch (e) {
    trackUsage({
      tenantId, userId, provider, eventType: "ai_generation",
      featureArea, edgeFunction, requestId, status: "error",
      metadata: { ...baseMeta, duration_ms: Date.now() - startedAt, error: String(e) },
    });
    throw e;
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const status = res.status === 429 ? "rate_limited" : res.status === 402 ? "payment_required" : "error";
    trackUsage({
      tenantId, userId, provider, eventType: "ai_generation",
      featureArea, edgeFunction, requestId, status,
      metadata: { ...baseMeta, duration_ms: durationMs, http_status: res.status, error_body: txt.slice(0, 500) },
    });
    if (res.status === 429) throw new Error("AI rate limited - please try again later");
    if (res.status === 402) throw new Error("AI credits exhausted - please add funds to workspace");
    throw new Error(`AI gateway error ${res.status}: ${txt}`);
  }

  const json: any = await res.json();
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? (promptTokens + completionTokens));

  const fullMeta = {
    ...baseMeta,
    provider_response_id: json?.id ?? null,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    duration_ms: durationMs,
    status: "success",
  };

  // 1 generation event
  trackUsage({
    tenantId, userId, provider, eventType: "ai_generation",
    featureArea, edgeFunction, requestId, status: "success",
    quantity: 1, unit: "generation", metadata: fullMeta,
  });
  // Input tokens
  if (promptTokens > 0) {
    trackUsage({
      tenantId, userId, provider, eventType: "ai_tokens_input",
      featureArea, edgeFunction, requestId, status: "success",
      quantity: promptTokens, unit: "token", metadata: fullMeta,
    });
  }
  // Output tokens
  if (completionTokens > 0) {
    trackUsage({
      tenantId, userId, provider, eventType: "ai_tokens_output",
      featureArea, edgeFunction, requestId, status: "success",
      quantity: completionTokens, unit: "token", metadata: fullMeta,
    });
  }

  console.log(`[AI] ${edgeFunction ?? "?"} ✓ ${text.length} chars, ${totalTokens} tok, ${durationMs}ms`);

  return { text, raw: json, promptTokens, completionTokens, totalTokens };
}

export function parseAIJson<T>(text: string, fallback: T): T {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(jsonStr) as T;
  } catch {
    console.warn("[AI] Failed to parse JSON from response, using fallback");
    return fallback;
  }
}
