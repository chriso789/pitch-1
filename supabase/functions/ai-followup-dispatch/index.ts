// ============================================
// AI FOLLOW-UP DISPATCH
// Sends AI-generated messages and logs to audit trail
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DispatchRequest {
  queue_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { queue_id } = (await req.json()) as DispatchRequest;

    if (!queue_id) {
      return new Response(
        JSON.stringify({ error: "Missing queue_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get queue item
    const { data: queueItem, error: queueError } = await supabase
      .from("ai_outreach_queue")
      .select("*")
      .eq("id", queue_id)
      .single();

    if (queueError || !queueItem) {
      return new Response(
        JSON.stringify({ error: "Queue item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get contact
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, phone, email")
      .eq("id", queueItem.contact_id)
      .eq("tenant_id", queueItem.tenant_id)
      .single();

    if (contactError || !contact) {
      await supabase
        .from("ai_outreach_queue")
        .update({ state: "failed", last_error: "Contact not found" })
        .eq("id", queue_id);
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate AI message
    const generateRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-followup-generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          tenant_id: queueItem.tenant_id,
          contact_id: queueItem.contact_id,
          channel_hint: queueItem.channel,
        }),
      }
    );

    if (!generateRes.ok) {
      const errText = await generateRes.text();
      throw new Error(`Failed to generate message: ${errText}`);
    }

    const generated = await generateRes.json();

    // Handle escalation
    if (generated.should_escalate) {
      await supabase
        .from("ai_outreach_queue")
        .update({
          state: "failed",
          last_error: generated.escalation_reason ?? "Escalation required",
          updated_at: new Date().toISOString(),
        })
        .eq("id", queue_id);

      console.log(`[ai-followup-dispatch] Escalated queue item ${queue_id}: ${generated.escalation_reason}`);

      return new Response(
        JSON.stringify({ ok: true, escalated: true, reason: generated.escalation_reason }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Empty message = opt-out detected
    if (!generated.message) {
      await supabase
        .from("ai_outreach_queue")
        .update({ state: "done", updated_at: new Date().toISOString() })
        .eq("id", queue_id);

      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "Empty message (opt-out)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const channel = generated.channel as "sms" | "email";

    // Send message based on channel
    if (channel === "sms") {
      if (!contact.phone) {
        throw new Error("Contact missing phone number");
      }

      // Use existing sms-send-reply function
      const smsRes = await supabase.functions.invoke("sms-send-reply", {
        body: {
          to: contact.phone,
          message: generated.message,
          threadId: queueItem.thread_id ?? undefined,
        },
      });

      if (smsRes.error) {
        throw new Error(`SMS send failed: ${smsRes.error.message}`);
      }

      console.log(`[ai-followup-dispatch] SMS sent to ${contact.phone}`);
    } else if (channel === "email") {
      // Send via email-send edge function
      if (!contact.email) {
        throw new Error("Contact missing email address for email channel");
      }
      
      // Get company name for subject line
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", queueItem.tenant_id)
        .single();
      
      const companyName = tenant?.name || "Your contractor";
      
      console.log(`[ai-followup-dispatch] Sending email to ${contact.email}`);
      
      const emailRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            to: contact.email,
            subject: `Following up - ${companyName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <p>Hi ${contact.first_name || "there"},</p>
                <p>${generated.message}</p>
                <p style="margin-top: 24px; color: #666; font-size: 14px;">
                  Best regards,<br/>
                  ${companyName}
                </p>
              </div>
            `,
            tenant_id: queueItem.tenant_id,
            contact_id: queueItem.contact_id,
          }),
        }
      );

      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.error(`[ai-followup-dispatch] Email send failed:`, errText);
        throw new Error(`Email send failed: ${errText}`);
      }

      const emailResult = await emailRes.json();
      console.log(`[ai-followup-dispatch] ✅ Email sent successfully, message_id: ${emailResult.message_id}`);
    }

    // Get or create AI conversation for audit trail
    const { data: existingConvo } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("tenant_id", queueItem.tenant_id)
      .eq("contact_id", queueItem.contact_id)
      .eq("channel", channel)
      .maybeSingle();

    let conversationId = existingConvo?.id;

    if (!conversationId) {
      const { data: newConvo } = await supabase
        .from("ai_conversations")
        .insert({
          tenant_id: queueItem.tenant_id,
          contact_id: queueItem.contact_id,
          channel,
          state: "open",
        })
        .select("id")
        .single();
      conversationId = newConvo?.id;
    }

    // Log AI message to audit trail
    if (conversationId) {
      await supabase.from("ai_messages").insert({
        tenant_id: queueItem.tenant_id,
        conversation_id: conversationId,
        direction: "outbound",
        content: generated.message,
        meta: {
          queue_id,
          channel,
          tags: generated.tags,
          ai_generated: true,
        },
      });

      // Update conversation timestamp
      await supabase
        .from("ai_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    // Update contact memory
    await supabase
      .from("ai_contact_memory")
      .upsert(
        {
          tenant_id: queueItem.tenant_id,
          contact_id: queueItem.contact_id,
          last_touch_at: new Date().toISOString(),
          tags: generated.tags ?? [],
        },
        { onConflict: "tenant_id,contact_id" }
      );

    // Update queue status
    await supabase
      .from("ai_outreach_queue")
      .update({
        state: "done",
        attempts: (queueItem.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", queue_id);

    console.log(`[ai-followup-dispatch] Successfully dispatched ${channel} for queue ${queue_id}`);

    return new Response(
      JSON.stringify({ ok: true, channel, message_length: generated.message.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[ai-followup-dispatch] Error:`, errorMessage);

    // Try to mark queue as failed
    try {
      const body = await req.clone().json();
      if (body?.queue_id) {
        await supabase
          .from("ai_outreach_queue")
          .update({ state: "failed", last_error: errorMessage })
          .eq("id", body.queue_id);
      }
    } catch {}

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
