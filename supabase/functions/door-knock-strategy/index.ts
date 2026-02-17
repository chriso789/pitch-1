// supabase/functions/door-knock-strategy/index.ts
// AI-powered door knock strategy generator with structured output + audit logging

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAIResponse, parseAIJson } from "../_shared/lovable-ai.ts";
import type { DoorKnockStrategyRequest, DoorKnockStrategyResponse } from "../_shared/types/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FALLBACK_STRATEGY = {
  angle: "insurance" as const,
  opener:
    "Hi, I'm with [Company]. We're doing free roof inspections in the neighborhood after the recent storms. Would you have a minute?",
  credibility:
    "We do free drone inspections and same-day temporary sealing if needed.",
  discovery_questions: [
    "Have you noticed any leaks or staining since the last big storm?",
    "How old do you think the roof is?",
    "Have you filed a claim before or would you rather start with a free inspection report?",
  ],
  likely_objections: [
    {
      objection: "I'm not interested.",
      response:
        "Totally fair — if I can do a free 5-minute exterior check and leave a photo report, would that be helpful?",
    },
  ],
  next_best_action:
    "Offer a free drone inspection appointment within 48 hours.",
  leave_behind:
    "Storm Damage Photo Report + 'What insurance usually covers' one-pager.",
  compliance_notes: [
    "Verify solicitation permit.",
    "Respect no-soliciting signs.",
    "If phone is DNC, do not call/text — door hanger + in-person only.",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = (await req.json()) as DoorKnockStrategyRequest;

    // Get user from auth header
    let userId = body.user_id ?? null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader && !userId) {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabase.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }

    const systemPrompt = `You are a canvassing coach for a roofing company.
Return ONLY valid JSON matching this exact schema:
{
  "angle": "insurance"|"retail"|"maintenance",
  "opener": string (1-2 sentence opening line),
  "credibility": string (why they should trust you),
  "discovery_questions": string[] (3-5 questions),
  "likely_objections": [{"objection": string, "response": string}] (2-4 pairs),
  "next_best_action": string,
  "leave_behind": string,
  "compliance_notes": string[] (1-3 notes)
}
Be concise, practical, and tailored to the property data provided.`;

    const userPrompt = `Property data:
${JSON.stringify(body.public ?? {}).slice(0, 6000)}

Contact data:
${JSON.stringify(body.contact ?? {}).slice(0, 3000)}

Scores:
Equity: ${body.scores?.equity?.score ?? "N/A"} (${(body.scores?.equity?.reasons || []).join(", ")})
Absentee: ${body.scores?.absentee?.score ?? "N/A"} (${(body.scores?.absentee?.reasons || []).join(", ")})
Roof Age: ${body.scores?.roof_age?.score ?? "N/A"} (${(body.scores?.roof_age?.reasons || []).join(", ")})

Time: ${body.context?.time_local ?? "unknown"}
Mode: ${body.context?.mode ?? "insurance"}
Goal: ${body.context?.goal ?? "inspection"}

Generate the best door knock strategy for this property.`;

    const { text } = await generateAIResponse({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.5,
    });

    const strategy = parseAIJson(text, FALLBACK_STRATEGY);

    // Log to canvass_strategy_log
    try {
      await supabase.from("canvass_strategy_log").insert({
        tenant_id: body.tenant_id,
        user_id: userId,
        property_id: body.property_id ?? null,
        normalized_address_key: body.normalized_address_key,
        request_context: {
          scores: body.scores,
          context: body.context,
        },
        strategy,
      });
    } catch (logErr) {
      console.warn("[door-knock-strategy] Failed to log strategy:", logErr);
    }

    const resp: DoorKnockStrategyResponse = { success: true, strategy };
    return new Response(JSON.stringify(resp), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[door-knock-strategy] Error:", error);
    return new Response(
      JSON.stringify({
        success: true,
        strategy: FALLBACK_STRATEGY,
        fallback: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
