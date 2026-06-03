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

    // Compact item list for the model
    const itemSummary = (items as IncomingItem[]).map((it) => {
      const type = it.item_type ? `[${it.item_type}]` : '';
      const trade = it.trade_type ? `(${it.trade_type})` : '';
      const qty = it.qty != null ? `${it.qty}${it.unit ? ' ' + it.unit : ''}` : '';
      const desc = it.description ? ` — ${it.description}` : '';
      return `- ${type}${trade} ${it.item_name || 'Item'} ${qty}${desc}`.trim();
    }).join('\n');

    const systemPrompt = `You are a senior roofing project manager writing the "Project Scope" section of a customer-facing proposal for ${company_name || 'a professional roofing contractor'}.

Your job: turn a technical line-item list (materials + labor) into a clear, easy-to-read narrative breakdown that explains the PROCESS the customer can expect — NOT a list of SKUs or part numbers. Group related items into logical project phases (e.g. Tear-Off & Prep, Insulation & Cover Board, Membrane Installation, Detailing & Flashings, Drains & Penetrations, Final Walkthrough), explain what happens in each phase and why, and reference the quality of the materials being used at a high level (brand + system, not every item by name).

Style guide:
- Tone: ${tone}. Confident, reassuring, professional. No hype.
- Use short section headings followed by 1–3 sentence paragraphs (or tight bullet lists).
- Do NOT list raw SKUs, quantities, or unit pricing. The customer sees pricing elsewhere.
- Do NOT invent work that wasn't in the line items.
- Do NOT use markdown bold/italics syntax (no **). Use plain text headings and dashes for bullets.
- Keep the entire scope under ~450 words.
- End with a brief "What This Means For You" closing line.
${extra_instructions ? `\nAdditional instructions: ${extra_instructions}` : ''}`;

    const userPrompt = `Project: ${project_title || 'Roofing project'}
Customer: ${customer_name || 'Customer'}
Address: ${property_address || 'Property'}

Line items from the estimate:
${itemSummary}

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
