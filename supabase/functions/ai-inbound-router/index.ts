// ============================================
// AI INBOUND ROUTER
// Handles homeowner replies with AI-powered responses
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAIResponse, parseAIJson } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InboundRequest {
  tenant_id: string;
  contact_id: string;
  inbound_text: string;
  channel?: "sms" | "email";
  from_number?: string;
}

interface AIReplyResponse {
  reply: string;
  should_escalate: boolean;
  escalation_reason: string | null;
  action?: string;
}

// Opt-out keywords
const OPT_OUT_KEYWORDS = [
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "do not contact",
  "dont contact",
  "remove me",
  "opt out",
  "optout",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = (await req.json()) as InboundRequest;
    const { tenant_id, contact_id, inbound_text, channel = "sms", from_number } = body;

    if (!tenant_id || !contact_id || !inbound_text) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedText = inbound_text.trim().toLowerCase();
    console.log(`[ai-inbound-router] Processing inbound from contact ${contact_id}: "${normalizedText.substring(0, 50)}..."`);

    // Check for opt-out keywords
    if (OPT_OUT_KEYWORDS.some((kw) => normalizedText === kw || normalizedText.includes(kw))) {
      console.log(`[ai-inbound-router] Opt-out detected for contact ${contact_id}`);

      // Update contact memory with do_not_contact flag
      await supabase.from("ai_contact_memory").upsert(
        {
          tenant_id,
          contact_id,
          risk_flags: ["do_not_contact"],
          last_response_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,contact_id" }
      );

      // Cancel any pending outreach
      await supabase
        .from("ai_outreach_queue")
        .update({ state: "canceled", last_error: "Contact opted out" })
        .eq("tenant_id", tenant_id)
        .eq("contact_id", contact_id)
        .in("state", ["queued", "running"]);

      return new Response(
        JSON.stringify({ ok: true, action: "do_not_contact", reply: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load context in parallel
    const [contactRes, memoryRes, historyRes, agentRes, tenantRes] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, first_name, last_name, phone, email, notes, tags")
        .eq("id", contact_id)
        .eq("tenant_id", tenant_id)
        .single(),
      supabase
        .from("ai_contact_memory")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("contact_id", contact_id)
        .maybeSingle(),
      supabase
        .from("ai_messages")
        .select("direction, content, created_at")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("ai_agents")
        .select("id, persona_prompt, safety_prompt, escalation_rules")
        .eq("tenant_id", tenant_id)
        .eq("enabled", true)
        .maybeSingle(),
      supabase.from("tenants").select("name").eq("id", tenant_id).single(),
    ]);

    const contact = contactRes.data;
    const memory = memoryRes.data;
    const history = historyRes.data ?? [];
    const agent = agentRes.data;
    const companyName = tenantRes.data?.name ?? "our company";

    if (!contact) {
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build AI prompt
    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "there";

    const systemPrompt = `${agent?.persona_prompt ?? `You are a follow-up assistant for ${companyName}, a roofing company.`}

Your role is to have a helpful conversation with homeowners who respond to our outreach.

RULES:
- Be brief and conversational (1-3 sentences for SMS)
- Goal: schedule an inspection or answer basic questions
- Never quote prices without an inspection
- If they ask about job status, ask for their address to look it up
- If they mention legal issues, lawyers, or want to speak to a manager, mark for escalation

${agent?.safety_prompt ?? ""}

RESPONSE FORMAT:
Return ONLY a JSON object:
{
  "reply": "your response text",
  "should_escalate": true or false,
  "escalation_reason": "reason if escalating, null otherwise"
}`;

    const userPrompt = `CONTACT: ${contactName}
THEIR MESSAGE: "${inbound_text}"

PREVIOUS AI CONVERSATION:
${history.map((m) => `${m.direction}: ${m.content}`).join("\n") || "No previous AI messages"}

MEMORY SUMMARY: ${memory?.summary ?? "None"}

Generate a helpful reply. Keep it under 160 characters for SMS.`;

    // Generate AI reply
    const { text } = await generateAIResponse({
      system: systemPrompt,
      user: userPrompt,
    });

    const fallback: AIReplyResponse = {
      reply: `Thanks for getting back to us, ${contactName}! Let me connect you with one of our team members who can help.`,
      should_escalate: false,
      escalation_reason: null,
    };

    const parsed = parseAIJson<AIReplyResponse>(text, fallback);

    const reply = String(parsed.reply ?? "").trim();
    const shouldEscalate = Boolean(parsed.should_escalate);

    // Get or create AI conversation
    const { data: existingConvo } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("contact_id", contact_id)
      .eq("channel", channel)
      .maybeSingle();

    let conversationId = existingConvo?.id;

    if (!conversationId) {
      const { data: newConvo } = await supabase
        .from("ai_conversations")
        .insert({
          tenant_id,
          contact_id,
          channel,
          state: shouldEscalate ? "escalated" : "open",
        })
        .select("id")
        .single();
      conversationId = newConvo?.id;
    } else if (shouldEscalate) {
      await supabase
        .from("ai_conversations")
        .update({ state: "escalated" })
        .eq("id", conversationId);
    }

    // Log both inbound and outbound messages
    if (conversationId) {
      await supabase.from("ai_messages").insert([
        {
          tenant_id,
          conversation_id: conversationId,
          direction: "inbound",
          content: inbound_text,
          meta: { from_number },
        },
        {
          tenant_id,
          conversation_id: conversationId,
          direction: "outbound",
          content: reply,
          meta: { ai_generated: true, should_escalate: shouldEscalate },
        },
      ]);

      await supabase
        .from("ai_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    // Update contact memory
    await supabase.from("ai_contact_memory").upsert(
      {
        tenant_id,
        contact_id,
        last_response_at: new Date().toISOString(),
        summary: memory?.summary ?? "",
      },
      { onConflict: "tenant_id,contact_id" }
    );

    // Send reply if SMS and not escalating
    if (channel === "sms" && contact.phone && reply && !shouldEscalate) {
      const smsRes = await supabase.functions.invoke("sms-send-reply", {
        body: { to: contact.phone, message: reply },
      });

      if (smsRes.error) {
        console.error("[ai-inbound-router] Failed to send SMS reply:", smsRes.error);
      } else {
        console.log(`[ai-inbound-router] Reply sent to ${contact.phone}`);
      }
    }

    // Update any pending queue items
    if (shouldEscalate) {
      await supabase
        .from("ai_outreach_queue")
        .update({ state: "failed", last_error: parsed.escalation_reason ?? "Escalation required" })
        .eq("tenant_id", tenant_id)
        .eq("contact_id", contact_id)
        .in("state", ["queued", "running"]);
    }

    console.log(`[ai-inbound-router] Processed inbound, escalated=${shouldEscalate}`);

    return new Response(
      JSON.stringify({
        ok: true,
        reply: shouldEscalate ? null : reply,
        escalated: shouldEscalate,
        escalation_reason: parsed.escalation_reason,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ai-inbound-router] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
