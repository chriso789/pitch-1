/**
 * SMS Send Reply Edge Function
 * Sends SMS via Telnyx or Twilio and creates/updates thread
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Verify user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's tenant
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(
        JSON.stringify({ error: "No tenant found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { to, message, threadId, contactId } = await req.json();

    if (!to || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone number
    let normalizedTo = to.replace(/\D/g, "");
    if (normalizedTo.length === 10) {
      normalizedTo = "1" + normalizedTo;
    }
    if (!normalizedTo.startsWith("+")) {
      normalizedTo = "+" + normalizedTo;
    }

    // Get tenant's communication preferences
    const { data: tenant } = await supabaseClient
      .from("tenants")
      .select("settings")
      .eq("id", profile.tenant_id)
      .single();

    // Determine SMS provider (prefer Telnyx if configured)
    const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
    const telnyxMessagingProfile = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID");
    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    let providerUsed = "";
    let providerMessageId = "";
    let fromNumber = "";
    let sendError: string | null = null;

    // Try Telnyx first
    if (telnyxApiKey && telnyxMessagingProfile) {
      try {
        const telnyxResponse = await fetch("https://api.telnyx.com/v2/messages", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${telnyxApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: telnyxMessagingProfile,
            to: normalizedTo,
            text: message,
            messaging_profile_id: telnyxMessagingProfile,
          }),
        });

        const telnyxData = await telnyxResponse.json();

        if (telnyxResponse.ok && telnyxData.data) {
          providerUsed = "telnyx";
          providerMessageId = telnyxData.data.id;
          fromNumber = telnyxData.data.from?.phone_number || "Telnyx";
        } else {
          sendError = telnyxData.errors?.[0]?.detail || "Telnyx send failed";
        }
      } catch (e) {
        sendError = `Telnyx error: ${e.message}`;
      }
    }

    // Fallback to Twilio
    if (!providerUsed && twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
        const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

        const twilioResponse = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${twilioAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: twilioPhoneNumber,
            To: normalizedTo,
            Body: message,
          }),
        });

        const twilioData = await twilioResponse.json();

        if (twilioResponse.ok && twilioData.sid) {
          providerUsed = "twilio";
          providerMessageId = twilioData.sid;
          fromNumber = twilioPhoneNumber;
          sendError = null;
        } else {
          sendError = twilioData.message || "Twilio send failed";
        }
      } catch (e) {
        sendError = `Twilio error: ${e.message}`;
      }
    }

    if (!providerUsed) {
      return new Response(
        JSON.stringify({ 
          error: "No SMS provider configured or all providers failed",
          details: sendError 
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role for database operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find or create thread
    let finalThreadId = threadId;

    if (!finalThreadId) {
      // Check for existing thread with this phone number
      const { data: existingThread } = await supabaseAdmin
        .from("sms_threads")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("phone_number", normalizedTo)
        .single();

      if (existingThread) {
        finalThreadId = existingThread.id;
      } else {
        // Create new thread
        const { data: newThread, error: threadError } = await supabaseAdmin
          .from("sms_threads")
          .insert({
            tenant_id: profile.tenant_id,
            phone_number: normalizedTo,
            contact_id: contactId || null,
            last_message_at: new Date().toISOString(),
            last_message_preview: message.substring(0, 100),
          })
          .select("id")
          .single();

        if (threadError) {
          console.error("Thread creation error:", threadError);
        } else {
          finalThreadId = newThread.id;
        }
      }
    }

    // Insert message
    if (finalThreadId) {
      const { error: msgError } = await supabaseAdmin
        .from("sms_messages")
        .insert({
          tenant_id: profile.tenant_id,
          thread_id: finalThreadId,
          contact_id: contactId || null,
          direction: "outbound",
          from_number: fromNumber,
          to_number: normalizedTo,
          body: message,
          status: "sent",
          provider: providerUsed,
          provider_message_id: providerMessageId,
          sent_at: new Date().toISOString(),
        });

      if (msgError) {
        console.error("Message insert error:", msgError);
      }
    }

    // Also log to communication_history for legacy compatibility
    await supabaseAdmin
      .from("communication_history")
      .insert({
        tenant_id: profile.tenant_id,
        contact_id: contactId || null,
        type: "sms",
        direction: "outbound",
        content: message,
        phone_number: normalizedTo,
        status: "sent",
        metadata: {
          provider: providerUsed,
          provider_message_id: providerMessageId,
          thread_id: finalThreadId,
        },
        created_by: user.id,
      });

    return new Response(
      JSON.stringify({
        success: true,
        provider: providerUsed,
        message_id: providerMessageId,
        thread_id: finalThreadId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("SMS send error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
