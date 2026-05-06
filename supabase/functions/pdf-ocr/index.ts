import "npm:@supabase/functions-js/src/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

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

    const { image_base64, page_number, page_width, page_height, render_scale } = await req.json();

    if (!image_base64) {
      return new Response(JSON.stringify({ error: 'image_base64 required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use Google Vision API or fallback to simple text extraction
    // For now, use the AI gateway for OCR
    const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY') || Deno.env.get('OPENAI_API_KEY');
    
    let ocrResult: { text: string; words: any[] } = { text: '', words: [] };

    if (Deno.env.get('OPENAI_API_KEY')) {
      // Use GPT-4o vision for OCR
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Extract all text from this image. Return a JSON object with "text" (the full extracted text) and "lines" (array of objects with "text", "x", "y", "width", "height" as approximate percentage positions 0-100). Be thorough and accurate.',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${image_base64}`,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 4096,
        }),
      });

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      if (content) {
        try {
          const parsed = JSON.parse(content);
          const scale = render_scale || 1.5;
          const pw = page_width || 612;
          const ph = page_height || 792;

          ocrResult.text = parsed.text || '';
          ocrResult.words = (parsed.lines || []).map((line: any, idx: number) => ({
            text: line.text || '',
            x: ((line.x || 0) / 100) * pw,
            y: ((line.y || 0) / 100) * ph,
            width: ((line.width || 10) / 100) * pw,
            height: ((line.height || 2) / 100) * ph,
            confidence: 85,
            line: idx,
          }));
        } catch {
          ocrResult.text = content;
        }
      }
    }

    return new Response(JSON.stringify({
      pageNumber: page_number,
      text: ocrResult.text,
      words: ocrResult.words,
      confidence: ocrResult.words.length > 0 ? 85 : 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[pdf-ocr] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
