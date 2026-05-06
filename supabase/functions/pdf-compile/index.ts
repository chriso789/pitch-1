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

    // Load document and operations
    const { data: doc } = await supabase
      .from('pdf_documents')
      .select('*')
      .eq('id', pdf_document_id)
      .single();

    if (!doc) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: operations } = await supabase
      .from('pdf_engine_operations')
      .select('*')
      .eq('pdf_document_id', pdf_document_id)
      .eq('is_undone', false)
      .order('created_at');

    // Compilation happens client-side with pdf-lib.
    // This endpoint tracks compilation status server-side.
    await supabase.from('pdf_documents')
      .update({ status: 'compiled' })
      .eq('id', pdf_document_id);

    return new Response(JSON.stringify({
      success: true,
      operation_count: (operations || []).length,
      message: 'Compilation status updated. Client performs actual pdf-lib compilation.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
