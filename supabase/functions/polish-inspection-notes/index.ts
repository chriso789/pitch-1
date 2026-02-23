import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generateAIResponse } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { notes, stepTitle, stepDescription } = await req.json();

    if (!notes || typeof notes !== "string" || notes.trim().length === 0) {
      return new Response(
        JSON.stringify({ polished: notes || "" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a professional property inspection report writer. Your job is to take raw, informal field notes (often voice-dictated) and rewrite them into clear, professional, grammatically correct observations suitable for a formal inspection report.

Rules:
- Preserve ALL factual details from the original notes. Do not omit anything.
- Do NOT add any information that is not present in the original notes.
- Fix grammar, spelling, punctuation, and sentence structure.
- Use professional, concise language appropriate for a construction inspection report.
- Keep it to 1-3 sentences unless the raw notes are very detailed.
- Write in third person or neutral observational tone (e.g., "Evidence of..." not "I saw...").
- Return ONLY the polished text, nothing else.`;

    const userPrompt = `Inspection step: ${stepTitle}
Step description: ${stepDescription}

Raw field notes to polish:
"${notes.trim()}"`;

    const result = await generateAIResponse({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.3,
    });

    return new Response(
      JSON.stringify({ polished: result.text.trim() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[polish-inspection-notes] Error:", error);
    // Fall back to returning the raw notes
    try {
      const body = await req.clone().json().catch(() => ({}));
      return new Response(
        JSON.stringify({ polished: body.notes || "", error: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch {
      return new Response(
        JSON.stringify({ polished: "", error: "Failed to polish notes" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }
});
