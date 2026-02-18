import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { generateAIResponse } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LANG_NAMES: Record<string, string> = {
  es: 'Spanish',
  pt: 'Portuguese',
  ht: 'Haitian Creole',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, target_language, fields } = await req.json();

    if (!target_language || target_language === 'en') {
      return new Response(JSON.stringify({ translated: content || fields }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const langName = LANG_NAMES[target_language] || target_language;

    // If fields object provided, translate each field
    if (fields && typeof fields === 'object') {
      const fieldEntries = Object.entries(fields).filter(([, v]) => typeof v === 'string' && (v as string).trim());
      const textToTranslate = fieldEntries.map(([k, v]) => `[${k}]: ${v}`).join('\n---\n');

      const { text } = await generateAIResponse({
        system: `You are a professional translator for construction/roofing proposals. Translate the following labeled fields to ${langName}. Keep the [field_name] labels unchanged. Only translate the content after the colon. Maintain professional construction terminology. Return in the same format.`,
        user: textToTranslate,
        temperature: 0.2,
      });

      // Parse back into object
      const translated: Record<string, string> = { ...fields };
      const lines = text.split('\n---\n');
      for (const line of lines) {
        const match = line.match(/\[(\w+)\]:\s*([\s\S]*)/);
        if (match) translated[match[1]] = match[2].trim();
      }

      return new Response(JSON.stringify({ translated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Single content string
    const { text } = await generateAIResponse({
      system: `You are a professional translator for construction/roofing proposals. Translate to ${langName}. Maintain professional construction terminology. Return only the translated text.`,
      user: content,
      temperature: 0.2,
    });

    return new Response(JSON.stringify({ translated: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[translate-proposal] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
