// supabase/functions/door-knock-strategy/index.ts
// AI-powered door knock strategy generator

import { generateAIResponse, parseAIJson } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface StrategyRequest {
  property: {
    address?: string;
    owner_name?: string;
    year_built?: number;
    homestead?: boolean;
    assessed_value?: number;
  };
  scores?: {
    equity?: { score: number; reasons: string[] };
    absentee?: { score: number; reasons: string[] };
    roof_age?: { score: number; reasons: string[] };
  };
  contact?: {
    phones?: { number: string; dnc?: boolean }[];
    age?: number;
  };
  time_of_day?: string; // "morning" | "afternoon" | "evening"
}

interface StrategyResponse {
  opener: string;
  angle: string;
  objections: { objection: string; response: string }[];
  next_action: string;
  compliance_notes: string;
}

const FALLBACK: StrategyResponse = {
  opener:
    "Hi, I'm with [Company]. We're doing free roof inspections in the neighborhood after the recent storms. Would you have a minute?",
  angle: "storm_inspection",
  objections: [
    {
      objection: "I'm not interested",
      response:
        "Totally understand. We're just documenting damage in the area — no obligation. Have a great day!",
    },
  ],
  next_action: "leave_door_hanger",
  compliance_notes: "Verify solicitation permit. Respect no-soliciting signs.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const body: StrategyRequest = await req.json();
    const { property, scores, contact, time_of_day } = body;

    const systemPrompt = `You are a door-to-door sales strategy AI for roofing contractors. 
Return ONLY valid JSON with this exact structure:
{
  "opener": "1-2 sentence opening line",
  "angle": "insurance | retail | maintenance | inspection",
  "objections": [{"objection": "...", "response": "..."}],
  "next_action": "leave_door_hanger | schedule_inspection | text_follow_up | callback",
  "compliance_notes": "brief compliance reminder"
}
Be concise, practical, and tailored to the property data provided.`;

    const userPrompt = `Property: ${property?.address || "Unknown"}
Owner: ${property?.owner_name || "Unknown"}
Year Built: ${property?.year_built || "Unknown"}
Homestead: ${property?.homestead ?? "Unknown"}
Assessed Value: ${property?.assessed_value ? `$${property.assessed_value.toLocaleString()}` : "Unknown"}
Equity Score: ${scores?.equity?.score ?? "N/A"} (${scores?.equity?.reasons?.join(", ") || ""})
Absentee Score: ${scores?.absentee?.score ?? "N/A"} (${scores?.absentee?.reasons?.join(", ") || ""})
Roof Age Score: ${scores?.roof_age?.score ?? "N/A"} (${scores?.roof_age?.reasons?.join(", ") || ""})
Contact Age: ${contact?.age || "Unknown"}
Has DNC Phones: ${contact?.phones?.some((p) => p.dnc) ? "Yes" : "No"}
Time of Day: ${time_of_day || "Unknown"}

Generate the best door knock strategy for this property.`;

    const { text } = await generateAIResponse({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.5,
    });

    const strategy = parseAIJson<StrategyResponse>(text, FALLBACK);

    return new Response(JSON.stringify({ success: true, strategy }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[door-knock-strategy] Error:", error);
    return new Response(
      JSON.stringify({ success: true, strategy: FALLBACK, fallback: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
