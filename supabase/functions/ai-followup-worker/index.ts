// AI follow-up worker for inbound SMS replies on MSFH-style campaigns.
// Called fire-and-forget from telnyx-inbound-webhook after a blast reply is matched.
//
// Pipeline:
//   1. Load the inbound message + last outbound blast item to find the blast
//   2. Check blast.ai_followup_enabled — bail if disabled
//   3. Classify intent via Lovable AI (google/gemini-2.5-flash-lite)
//   4. If intent is conversational (positive_interest | inspection_question | call_me |
//      financing_question | roof_issue), generate a consultative reply
//   5. Send reply via telnyx-send-sms with ai_generated metadata
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const SYSTEM_PROMPT = `You are a local roofing and restoration specialist helping Florida homeowners understand and navigate the My Safe Florida Home (MSFH) grant program.

Your role is to:
- educate, never sell
- guide and simplify the process
- answer questions about inspections, eligibility, and timelines
- offer to help schedule a free wind-mitigation inspection when appropriate

Hard rules:
- Keep replies under 320 characters when possible. SMS-friendly tone.
- No emojis. No exclamation points. No aggressive urgency.
- Never claim guaranteed approval or specific dollar amounts.
- If the homeowner asks for a call, confirm a good time window and say a teammate will reach out.
- If the homeowner says they already applied, congratulate them briefly and offer help if they have issues.
- Always sound like a neighbor who knows the program, not a salesperson.`;

async function classifyIntent(apiKey: string, body: string): Promise<string> {
  const res = await fetch(LOVABLE_AI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        {
          role: 'system',
          content: 'Classify the homeowner SMS reply into ONE of: positive_interest, not_interested, stop, already_applied, call_me, inspection_question, roof_issue, financing_question, other. Reply with only the label.',
        },
        { role: 'user', content: body.slice(0, 500) },
      ],
    }),
  });
  if (!res.ok) {
    console.error('[ai-followup] classify failed', res.status, await res.text());
    return 'other';
  }
  const json = await res.json();
  const raw = String(json?.choices?.[0]?.message?.content || 'other').toLowerCase().trim();
  return raw.replace(/[^a-z_]/g, '');
}

async function generateReply(
  apiKey: string,
  inboundBody: string,
  intent: string,
  contact: any,
): Promise<string | null> {
  const userContext = `Homeowner ${contact?.first_name || 'there'} replied: "${inboundBody}"

Classified intent: ${intent}
Property: ${contact?.address_street || 'unknown'}, ${contact?.address_city || ''}, FL

Write a short consultative SMS reply.`;

  const res = await fetch(LOVABLE_AI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContext },
      ],
    }),
  });
  if (!res.ok) {
    console.error('[ai-followup] generate failed', res.status, await res.text());
    return null;
  }
  const json = await res.json();
  const txt = String(json?.choices?.[0]?.message?.content || '').trim();
  return txt || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { tenant_id, contact_id, from_phone, to_phone, body } = await req.json();
    if (!tenant_id || !from_phone || !body) {
      return new Response(JSON.stringify({ error: 'missing fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Find the most recent blast this phone was on, and confirm AI follow-up is enabled
    const { data: lastItem } = await supabase
      .from('sms_blast_items')
      .select('id, blast_id, sms_blasts!inner(id, ai_followup_enabled, goal, tenant_id, created_by)')
      .eq('tenant_id', tenant_id)
      .eq('phone', from_phone)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const blast: any = (lastItem as any)?.sms_blasts;
    if (!blast || !blast.ai_followup_enabled) {
      return new Response(JSON.stringify({ skipped: 'ai_followup_disabled_or_no_blast' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Classify
    const intent = await classifyIntent(apiKey, body);
    console.log('[ai-followup] intent', intent, 'for', from_phone);

    // STOP / not_interested → never reply
    const SILENT = new Set(['stop', 'not_interested', 'other']);
    if (SILENT.has(intent)) {
      return new Response(JSON.stringify({ intent, replied: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Generate reply with contact context
    let contact: any = null;
    if (contact_id) {
      const { data: c } = await supabase
        .from('contacts')
        .select('first_name, last_name, address_street, address_city, address_state')
        .eq('id', contact_id).maybeSingle();
      contact = c;
    }

    const reply = await generateReply(apiKey, body, intent, contact || {});
    if (!reply) {
      return new Response(JSON.stringify({ intent, replied: false, error: 'generation_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Send via telnyx-send-sms (returns to the SAME number they messaged)
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        to: from_phone,
        from: to_phone, // route reply back through the same Telnyx number
        message: reply,
        contactId: contact_id,
        tenant_id,
        sent_by: blast.created_by,
        ai_generated: true,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({}));

    return new Response(
      JSON.stringify({ intent, replied: !!sendJson?.success, reply, telnyx: sendJson }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[ai-followup] fatal', e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
