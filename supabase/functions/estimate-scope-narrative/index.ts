const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface IncomingItem {
  item_name?: string;
  description?: string | null;
  qty?: number;
  unit?: string;
  item_type?: string;
  trade_type?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      items = [],
      change_order_items = [],
      project_title,
      customer_name,
      property_address,
      company_name,
      tone = 'professional',
      extra_instructions,
    } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'items array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const formatItems = (arr: IncomingItem[]) => arr.map((it) => {
      const type = it.item_type ? `[${it.item_type}]` : '';
      const trade = it.trade_type ? `(${it.trade_type})` : '';
      const qty = it.qty != null ? `${it.qty}${it.unit ? ' ' + it.unit : ''}` : '';
      const desc = it.description ? ` — ${it.description}` : '';
      return `- ${type}${trade} ${it.item_name || 'Item'} ${qty}${desc}`.trim();
    }).join('\n');

    const itemSummary = formatItems(items as IncomingItem[]);
    const hasChangeOrders = Array.isArray(change_order_items) && change_order_items.length > 0;
    const changeOrderSummary = hasChangeOrders ? formatItems(change_order_items as IncomingItem[]) : '';

    const changeOrderSection = hasChangeOrders ? `

Potential Change Orders
A short intro sentence explaining these are optional/conditional items that may be added if site conditions or customer selections require them, followed by a bulleted list (one tight sentence each, leading "- ") describing each potential change order in customer-friendly language. Do NOT include pricing.` : '';

    const systemPrompt = `You are a senior roofing project manager writing the "Project Scope" section of a customer-facing proposal for ${company_name || 'a professional roofing contractor'}.

Turn the technical line-item list into a clean, bulletin-style scope the customer can skim. No SKUs, quantities, or unit pricing.

Required structure (in this exact order, use these exact headings on their own line):

Opening
One short paragraph (2–3 sentences) introducing the project, the property, and the overall system/approach being installed.

Scope of Work
A bulleted list of 6–12 concise bullets covering the work in logical order (e.g. Tear-Off & Prep, Decking & Repairs, Underlayment & Ice/Water Shield, Flashings & Penetrations, Main System Installation, Ventilation, Ridge & Detailing, Cleanup & Final Walkthrough). Each bullet: one tight sentence starting with a strong verb. Reference material brand/system at a high level when relevant. Use a leading "- " for each bullet. No numbered lists.
${changeOrderSection}
Closing
One short paragraph (1–2 sentences) reassuring the customer about quality, cleanup, warranty-readiness, and next steps.

Style:
- Tone: ${tone}. Confident, reassuring, professional. No hype.
- Plain text only — no markdown bold/italics (no **, no _).
- Do NOT invent work not implied by the line items.
- Keep the entire scope under ~400 words.
${extra_instructions ? `\nAdditional instructions: ${extra_instructions}` : ''}`;

    const userPrompt = `Project: ${project_title || 'Roofing project'}
Customer: ${customer_name || 'Customer'}
Address: ${property_address || 'Property'}

Line items from the estimate:
${itemSummary}
${hasChangeOrders ? `\nPotential Change Order items (optional/conditional add-ons — include them in a dedicated "Potential Change Orders" section):\n${changeOrderSummary}\n` : ''}
Write the customer-friendly Project Scope now.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[estimate-scope-narrative] gateway error', response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Add credits in workspace billing.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'AI gateway error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    const narrative = result.choices?.[0]?.message?.content?.trim() || '';

    return new Response(JSON.stringify({ narrative }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[estimate-scope-narrative] error', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
