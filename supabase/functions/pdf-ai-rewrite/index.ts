import { corsHeaders } from '@supabase/supabase-js/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { workspace_document_id, selected_text, instruction, page_number } = await req.json();
    if (!workspace_document_id || !selected_text || !instruction) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Verify access
    const { data: wsDoc } = await adminClient.from('pdf_workspace_documents').select('tenant_id').eq('id', workspace_document_id).single();
    if (!wsDoc) return new Response(JSON.stringify({ error: 'Document not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Insert AI edit record
    const { data: editRow, error: insertErr } = await adminClient.from('pdf_workspace_ai_edits').insert({
      workspace_document_id, tenant_id: wsDoc.tenant_id, page_number: page_number || null,
      selected_text, instruction, status: 'suggested', created_by: user.id,
    }).select().single();

    if (insertErr) throw insertErr;

    // Call OpenAI
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    let replacement_text = selected_text;

    if (openaiKey) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are rewriting selected text from a contractor CRM PDF. Preserve meaning. Do not invent legal terms, prices, dates, warranties, or promises. If text looks like legal contract language, keep it conservative and clear. Return only the replacement text.' },
            { role: 'user', content: `Original text:\n${selected_text}\n\nInstruction: ${instruction}` }
          ],
          temperature: 0.3, max_tokens: 1000,
        }),
      });
      const result = await resp.json();
      replacement_text = result.choices?.[0]?.message?.content || selected_text;
    }

    // Update record
    await adminClient.from('pdf_workspace_ai_edits').update({ replacement_text, status: 'suggested' }).eq('id', editRow.id);

    return new Response(JSON.stringify({ id: editRow.id, replacement_text, status: 'suggested' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
