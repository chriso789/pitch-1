import "npm:@supabase/functions-js/src/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { original_text, mode, custom_instruction, context } = await req.json();

    if (!original_text || !mode) {
      return new Response(JSON.stringify({ error: 'original_text and mode required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const modeInstructions: Record<string, string> = {
      professional: 'Rewrite this text in a professional, business-appropriate tone. Keep the same meaning but improve clarity and professionalism.',
      concise: 'Rewrite this text to be more concise and direct. Remove unnecessary words while preserving the meaning.',
      formal: 'Rewrite this text in a formal, legal-appropriate tone. Use formal language and structure.',
      friendly: 'Rewrite this text in a friendly, approachable tone while keeping it professional.',
      custom: custom_instruction || 'Improve this text.',
    };

    const systemPrompt = `You are a document editor assistant for a construction CRM. ${modeInstructions[mode] || modeInstructions.professional}
${context ? `Context: ${context}` : ''}
Return ONLY the rewritten text, no explanations or quotes.`;

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: original_text },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    const result = await response.json();
    const rewrittenText = result.choices?.[0]?.message?.content?.trim() || original_text;

    return new Response(JSON.stringify({ rewritten_text: rewrittenText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[pdf-ai-rewrite] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
