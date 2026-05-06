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
    const { pdf_document_id } = await req.json();
    if (!pdf_document_id) {
      return new Response(JSON.stringify({ error: 'pdf_document_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check if OCR is needed by looking for pages with no extracted text
    const { data: pages } = await supabase
      .from('pdf_engine_pages')
      .select('id, page_number, extracted_text')
      .eq('pdf_document_id', pdf_document_id)
      .order('page_number');

    const pagesNeedingOcr = (pages || []).filter(
      (p: any) => !p.extracted_text || p.extracted_text.trim().length === 0
    );

    if (pagesNeedingOcr.length > 0) {
      // Mark pages as needing OCR — actual OCR is a future phase
      return new Response(JSON.stringify({
        success: true,
        ocr_required: true,
        pages_needing_ocr: pagesNeedingOcr.map((p: any) => p.page_number),
        message: 'OCR pipeline is a future phase. Pages requiring OCR have been identified.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Return extracted text summary
    const fullText = (pages || []).map((p: any) => p.extracted_text || '').join('\n\n');

    return new Response(JSON.stringify({
      success: true,
      ocr_required: false,
      page_count: (pages || []).length,
      text_length: fullText.length,
      text_preview: fullText.slice(0, 500),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
