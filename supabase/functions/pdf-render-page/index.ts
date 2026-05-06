import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pdf_document_id, page_number, scale } = await req.json();
    if (!pdf_document_id || !page_number) {
      return new Response(JSON.stringify({ error: 'pdf_document_id and page_number required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Page rendering happens client-side via PDF.js.
    // This endpoint is a placeholder for future server-side rendering with mupdf/sharp.
    return new Response(JSON.stringify({
      success: true,
      message: 'Page rendering is handled client-side via PDF.js. Server-side rendering (mupdf/sharp) is a future phase.',
      pdf_document_id,
      page_number,
      scale: scale || 1.5,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
