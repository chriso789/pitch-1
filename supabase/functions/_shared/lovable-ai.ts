// ============================================
// LOVABLE AI GATEWAY HELPER
// Server-side AI integration using Lovable AI Gateway
// ============================================

export interface AIResponseResult {
  text: string;
  raw: unknown;
}

export interface AIRequestOptions {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
}

/**
 * Generate AI response using Lovable AI Gateway
 * Uses pre-configured LOVABLE_API_KEY - never exposed to frontend
 */
export async function generateAIResponse({
  system,
  user,
  model = "google/gemini-3-flash-preview",
  temperature = 0.4,
}: AIRequestOptions): Promise<AIResponseResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    throw new Error("Missing LOVABLE_API_KEY - ensure Cloud is enabled");
  }

  console.log(`[AI] Calling Lovable AI Gateway with model: ${model}`);

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    }),
  });

  if (res.status === 429) {
    console.error("[AI] Rate limited by Lovable AI Gateway");
    throw new Error("AI rate limited - please try again later");
  }

  if (res.status === 402) {
    console.error("[AI] Lovable AI credits exhausted");
    throw new Error("AI credits exhausted - please add funds to workspace");
  }

  if (!res.ok) {
    const txt = await res.text();
    console.error(`[AI] Gateway error ${res.status}: ${txt}`);
    throw new Error(`AI gateway error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";

  console.log(`[AI] Response received (${text.length} chars)`);

  return { text, raw: json };
}

/**
 * Parse JSON from AI response with fallback
 */
export function parseAIJson<T>(text: string, fallback: T): T {
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(jsonStr) as T;
  } catch {
    console.warn("[AI] Failed to parse JSON from response, using fallback");
    return fallback;
  }
}
