import { createOpenAI } from 'npm:@ai-sdk/openai';
import { streamText } from 'npm:ai';
import { createLovableAiGatewayRunIdFetch } from '../_shared/lovable-ai-run-id.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-pitch-tenant',
};

interface IncomingItem {
  item_name?: string;
  description?: string | null;
  qty?: number;
  unit?: string;
  item_type?: string;
  trade_type?: string;
  emphasize?: boolean;
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
      output_mode = 'proposal_scope',
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
      const emph = it.emphasize ? ' [EMPHASIZE]' : '';
      return `- ${type}${trade} ${it.item_name || 'Item'} ${qty}${desc}${emph}`.trim();
    }).join('\n');

    const itemSummary = formatItems(items as IncomingItem[]);
    const hasChangeOrders = Array.isArray(change_order_items) && change_order_items.length > 0;
    const changeOrderSummary = hasChangeOrders ? formatItems(change_order_items as IncomingItem[]) : '';

    // Detect turnkey items — bundled subcontracted scopes that should be
    // presented as an all-inclusive package rather than a line-item list.
    const turnkeyItems = (items as IncomingItem[]).filter(
      (it) => (it.item_type || '').toLowerCase() === 'turnkey',
    );
    const hasTurnkey = turnkeyItems.length > 0;
    const isFullyTurnkey = hasTurnkey && turnkeyItems.length === items.length;

    const changeOrderSection = hasChangeOrders ? `

Potential Change Orders
A short intro sentence explaining these are optional/conditional items that may be added if site conditions or customer selections require them, followed by a bulleted list (one tight sentence each, leading "- ") describing each potential change order in customer-friendly language. Do NOT include pricing.` : '';

    const turnkeySection = hasTurnkey ? `

Turnkey Package
One short sentence stating this is an all-inclusive package. Then a bulleted list (leading "- ", a few words each) naming each turnkey scope — no explanations, no reassurances, just the scope name. Keep it to 3–5 words per bullet.` : '';

    const isFinalInvoice = output_mode === 'final_invoice_summary';
    const systemPrompt = isFinalInvoice
      ? `You are a senior construction project manager writing a concise "Work Performed" description for a homeowner's final paid-in-full invoice from ${company_name || 'a professional contractor'}.

Summarize the type of work completed and the major phases of the finished project. Synthesize the estimate into natural, customer-facing language rather than copying, listing, or paraphrasing every line item.

Rules:
- Return plain text only: one short heading-style sentence naming the completed system, followed by one compact paragraph of 2–4 sentences.
- Mention the major work performed, installation approach, cleanup, and completed result when supported by the estimate.
- Do not include bullets, SKUs, quantities, prices, job number, estimate number, customer name, or address.
- Do not invent work not supported by the estimate.
- Keep the complete description under 110 words.
${extra_instructions ? `\nAdditional instructions: ${extra_instructions}` : ''}`
      : `You are a senior roofing project manager writing the "Project Scope" section of a customer-facing proposal for ${company_name || 'a professional roofing contractor'}.

Turn the technical line-item list into a clean, bulletin-style scope the customer can skim. No SKUs, quantities, or unit pricing.

Required structure (in this exact order, use these exact headings on their own line):

Scope of Work
A bulleted list of 6–12 concise bullets covering the work in logical order (e.g. Tear-Off & Prep, Decking & Repairs, Underlayment & Ice/Water Shield, Flashings & Penetrations, Main System Installation, Ventilation, Ridge & Detailing, Cleanup & Final Walkthrough). Each bullet: one tight sentence starting with a strong verb. Reference material brand/system at a high level when relevant. Use a leading "- " for each bullet. No numbered lists. Do NOT include separate bullets or detail about permits or debris removal/trash hauling — those are covered in the Closing. A "Cleanup & Final Walkthrough" bullet should focus on jobsite broom-clean condition and final inspection only, not on hauling or disposal.${turnkeySection}
${changeOrderSection}
Closing
One short paragraph (2–4 sentences) that introduces the overall system/approach being installed and reassures the customer about quality, cleanup, warranty-readiness, and next steps. This paragraph MUST explicitly state that all required permits and debris removal / trash hauling are included in the total cost — the customer will not be billed separately for these. State it once here; do NOT repeat it in the Scope of Work bullets. Do NOT mention the property address or the customer/homeowner name anywhere in the narrative.

Style:
- Tone: ${tone}. Confident, reassuring, professional. No hype.
- Plain text only, with ONE exception: any line item marked [EMPHASIZE] must be given its own dedicated bullet in the relevant section, and the ENTIRE sentence of that bullet — the item name and the full description of what it means for the customer — must be wrapped in **double asterisks** so the whole line renders bold (not just one or two words). Never output the literal token [EMPHASIZE]. Do not bold anything else and never use italics/underscores.
- Every [EMPHASIZE] item must be mentioned explicitly by name (for example a discount, upgrade, or warranty), even if it is not physical work.
- Write in the present tense as if the work and pricing are already settled: never use imperative or future-tense verbs like "apply", "will apply", or "add" for items that are already included in this estimate. A discount line, for example, is already reflected in the price — describe it as "A military discount has been applied..." or "Your military discount is included...", never "Apply a military discount...".
- Do NOT invent work not implied by the line items.
- Keep the entire scope under ~400 words.
${extra_instructions ? `\nAdditional instructions: ${extra_instructions}` : ''}`;

    const userPrompt = `Project: ${project_title || 'Roofing project'}

Line items from the estimate:
${itemSummary}
${hasChangeOrders ? `\nPotential Change Order items (optional/conditional add-ons — include them in a dedicated "Potential Change Orders" section):\n${changeOrderSummary}\n` : ''}
${isFinalInvoice
  ? 'Write the concise final-invoice Work Performed description now.'
  : 'Write the customer-friendly Project Scope now. Do not mention the property address or the customer/homeowner name anywhere.'}`;

    const runIdFetch = createLovableAiGatewayRunIdFetch(req.headers.get('X-Lovable-AIG-Run-ID') || undefined);
    const provider = createOpenAI({
      baseURL: 'https://ai.gateway.lovable.dev/v1',
      apiKey: lovableKey,
      headers: {
        'Lovable-API-Key': lovableKey,
        'X-Lovable-AIG-SDK': 'vercel-ai-sdk',
      },
      fetch: runIdFetch.fetch,
    });
    const result = streamText({
      model: provider.responses('openai/gpt-6-astra'),
      instructions: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      abortSignal: req.signal,
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: 'low',
          reasoningSummary: 'auto',
          store: false,
          include: ['reasoning.encrypted_content'],
        },
      },
    });
    const narrative = (await result.text).trim();
    if (!narrative) throw new Error('Lovable AI returned an empty work description.');

    return new Response(JSON.stringify({ narrative }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        ...(runIdFetch.getRunId() ? { 'X-Lovable-AIG-Run-ID': runIdFetch.getRunId() as string } : {}),
      },
    });
  } catch (err: any) {
    console.error('[estimate-scope-narrative] error', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
