// ============================================
// AI FOLLOW-UP GENERATE
// LLM-powered message generation for follow-ups
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAIResponse, parseAIJson } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  tenant_id: string;
  contact_id: string;
  goal?: string;
  channel_hint?: "sms" | "email";
}

interface GenerateResponse {
  channel: "sms" | "email";
  message: string;
  should_escalate: boolean;
  escalation_reason: string | null;
  tags: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as GenerateRequest;
    const { tenant_id, contact_id, goal = "book_inspection", channel_hint } = body;

    if (!tenant_id || !contact_id) {
      return new Response(
        JSON.stringify({ error: "Missing tenant_id or contact_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase admin client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load contact, memory, and recent messages in parallel
    const [contactRes, memoryRes, inboxRes, agentRes, tenantRes] = await Promise.all([
      supabase
        .from("contacts")
        .select("id, first_name, last_name, phone, email, type, qualification_status, notes, tags, lead_source")
        .eq("id", contact_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle(),
      supabase
        .from("ai_contact_memory")
        .select("*")
        .eq("contact_id", contact_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle(),
      supabase
        .from("unified_inbox")
        .select("channel, direction, content, subject, created_at")
        .eq("tenant_id", tenant_id)
        .eq("contact_id", contact_id)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("ai_agents")
        .select("id, persona_prompt, safety_prompt, escalation_rules")
        .eq("tenant_id", tenant_id)
        .eq("enabled", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tenants")
        .select("name")
        .eq("id", tenant_id)
        .single(),
    ]);

    if (!contactRes.data) {
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contact = contactRes.data;
    const memory = memoryRes.data;
    const inbox = inboxRes.data ?? [];
    const agent = agentRes.data;
    const companyName = tenantRes.data?.name ?? "our company";

    // Check for do_not_contact flag
    if (memory?.risk_flags?.includes("do_not_contact")) {
      return new Response(
        JSON.stringify({
          channel: channel_hint ?? "sms",
          message: "",
          should_escalate: false,
          escalation_reason: "Contact has opted out",
          tags: ["opted_out"],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build AI prompt
    const defaultPersona = `You are a follow-up specialist for ${companyName}, a roofing and home services company.
Your job is to re-engage leads who haven't responded in a while.
Be friendly, professional, and helpful. Your goal is to schedule inspections and answer basic questions.`;

    const defaultSafety = `Never claim to be human.
Never provide specific pricing without scheduling an inspection first.
If someone says STOP, mark them as opted out.
Keep SMS messages under 320 characters.
If the homeowner mentions legal issues, lawyers, or insurance disputes, mark for escalation.`;

    const systemPrompt = `${agent?.persona_prompt ?? defaultPersona}

SAFETY RULES:
${agent?.safety_prompt ?? defaultSafety}

RESPONSE FORMAT:
Return ONLY a JSON object with these exact keys:
{
  "channel": "sms" or "email",
  "message": "your message text",
  "should_escalate": true or false,
  "escalation_reason": "reason if escalating, null otherwise",
  "tags": ["array", "of", "tags"]
}`;

    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "there";
    
    const userPrompt = `CONTACT INFORMATION:
Name: ${contactName}
Phone: ${contact.phone ?? "N/A"}
Email: ${contact.email ?? "N/A"}
Type: ${contact.type ?? "lead"}
Status: ${contact.qualification_status ?? "unknown"}
Lead Source: ${contact.lead_source ?? "unknown"}
Notes: ${contact.notes ?? "None"}
Tags: ${contact.tags?.join(", ") ?? "None"}

AI MEMORY FOR THIS CONTACT:
Summary: ${memory?.summary ?? "No previous AI interactions"}
Last AI Touch: ${memory?.last_touch_at ?? "Never"}
Last Response: ${memory?.last_response_at ?? "Never"}
Memory Tags: ${memory?.tags?.join(", ") ?? "None"}
Risk Flags: ${memory?.risk_flags?.join(", ") ?? "None"}

RECENT ACTIVITY (newest first):
${inbox.length > 0 ? JSON.stringify(inbox, null, 2) : "No recent activity"}

GOAL: ${goal}
PREFERRED CHANNEL: ${channel_hint ?? "sms (default)"}
COMPANY NAME: ${companyName}

Generate the next best follow-up message. Keep SMS under 320 characters. For email, write 3-5 sentences max.`;

    // Call Lovable AI
    const { text } = await generateAIResponse({
      system: systemPrompt,
      user: userPrompt,
    });

    // Parse response
    const fallback: GenerateResponse = {
      channel: channel_hint ?? "sms",
      message: `Hi ${contactName}, this is ${companyName} following up. Do you have any questions about your roof?`,
      should_escalate: false,
      escalation_reason: null,
      tags: ["ai_generated", "fallback"],
    };

    const parsed = parseAIJson<GenerateResponse>(text, fallback);

    // Validate and clean response
    const response: GenerateResponse = {
      channel: ["sms", "email"].includes(parsed.channel) ? parsed.channel : (channel_hint ?? "sms"),
      message: String(parsed.message ?? "").trim(),
      should_escalate: Boolean(parsed.should_escalate),
      escalation_reason: parsed.escalation_reason ?? null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };

    // Safety check: empty message means don't send
    if (!response.message) {
      response.should_escalate = true;
      response.escalation_reason = "AI generated empty message";
    }

    // Truncate SMS if too long
    if (response.channel === "sms" && response.message.length > 320) {
      response.message = response.message.substring(0, 317) + "...";
    }

    console.log(`[ai-followup-generate] Generated ${response.channel} message for contact ${contact_id}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ai-followup-generate] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
