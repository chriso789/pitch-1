// Backfill ai_usage_metrics from historical AI activity tables.
// Idempotent: skips rows whose request_id already exists.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same pricing table as src/utils/aiMetricsLogger.ts
const COST: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-pro": { input: 1.25, output: 5 },
  "google/gemini-2.5-flash": { input: 0.075, output: 0.3 },
  "google/gemini-2.5-flash-lite": { input: 0.015, output: 0.06 },
  "google/gemini-3-flash-preview": { input: 0.075, output: 0.3 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 5, output: 15 },
};

function estimateCost(model: string, p: number, c: number): number {
  const m = COST[model] ?? { input: 0.1, output: 0.4 };
  return (p / 1_000_000) * m.input + (c / 1_000_000) * m.output;
}

function tokensFromText(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const inserts: any[] = [];
  let scanned = 0;

  // 1) ai_chat_messages — pair user→assistant within same session
  const { data: chats } = await supabase
    .from("ai_chat_messages")
    .select("id, session_id, tenant_id, role, content, created_at")
    .order("session_id", { ascending: true })
    .order("created_at", { ascending: true });

  if (chats) {
    scanned += chats.length;
    let lastUserTokens = 0;
    let lastSession: string | null = null;
    for (const m of chats) {
      if (m.session_id !== lastSession) { lastSession = m.session_id; lastUserTokens = 0; }
      if (m.role === "user") {
        lastUserTokens = tokensFromText(m.content);
      } else if (m.role === "assistant") {
        const completion = tokensFromText(m.content);
        const prompt = lastUserTokens || 200;
        inserts.push({
          tenant_id: m.tenant_id,
          provider: "lovable-ai",
          model: "google/gemini-2.5-flash",
          feature: "crm-ai-agent",
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: prompt + completion,
          response_time_ms: 1200,
          status: "success",
          estimated_cost_usd: estimateCost("google/gemini-2.5-flash", prompt, completion),
          request_id: `backfill-chat-${m.id}`,
          endpoint: "/functions/v1/crm-ai-agent",
          created_at: m.created_at,
        });
        lastUserTokens = 0;
      }
    }
  }

  // 2) ai_measurement_jobs — each represents a vision-model invocation
  const { data: jobs } = await supabase
    .from("ai_measurement_jobs")
    .select("id, tenant_id, user_id, status, created_at, completed_at, started_at");

  if (jobs) {
    scanned += jobs.length;
    for (const j of jobs) {
      const start = j.started_at ?? j.created_at;
      const end = j.completed_at ?? j.created_at;
      const ms = Math.max(500, new Date(end).getTime() - new Date(start).getTime());
      const success = j.status === "completed" || j.status === "succeeded" || j.status === "completed_review";
      inserts.push({
        tenant_id: j.tenant_id,
        user_id: j.user_id,
        provider: "lovable-ai",
        model: "google/gemini-2.5-pro",
        feature: "ai-measurement",
        prompt_tokens: 1500,
        completion_tokens: 800,
        total_tokens: 2300,
        response_time_ms: Math.min(ms, 600000),
        status: success ? "success" : "error",
        estimated_cost_usd: estimateCost("google/gemini-2.5-pro", 1500, 800),
        request_id: `backfill-meas-${j.id}`,
        endpoint: "/functions/v1/start-ai-measurement",
        created_at: j.created_at,
      });
    }
  }

  // De-dupe against existing request_ids
  const ids = inserts.map((r) => r.request_id);
  const existingIds = new Set<string>();
  const chunk = 500;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data } = await supabase
      .from("ai_usage_metrics")
      .select("request_id")
      .in("request_id", slice);
    data?.forEach((r) => existingIds.add(r.request_id as string));
  }

  const fresh = inserts.filter((r) => r.tenant_id && !existingIds.has(r.request_id));

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += chunk) {
    const slice = fresh.slice(i, i + chunk);
    const { error } = await supabase.from("ai_usage_metrics").insert(slice);
    if (error) {
      console.error("insert error", error);
    } else {
      inserted += slice.length;
    }
  }

  return new Response(
    JSON.stringify({ scanned, candidates: inserts.length, inserted, skipped: inserts.length - fresh.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
};

Deno.serve(handler);
