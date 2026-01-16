/**
 * Email Send Edge Function
 * Sends emails via Resend API and logs to communication_history
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EMAIL_CONFIG, getFromEmail } from "../_shared/email-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from_name?: string;
  reply_to?: string;
  tenant_id?: string;
  contact_id?: string;
  job_id?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: EmailRequest = await req.json();
    const { to, subject, html, text, from_name, reply_to, tenant_id, contact_id, job_id, user_id, metadata } = body;

    // Validate required fields
    if (!to || !subject) {
      throw new Error("Missing required fields: to, subject");
    }
    if (!html && !text) {
      throw new Error("Either html or text body is required");
    }

    // Build from address
    const fromEmail = getFromEmail("notifications");
    const fromHeader = from_name ? `${from_name} <${fromEmail}>` : `${EMAIL_CONFIG.brand.name} <${fromEmail}>`;

    // Prepare recipients
    const recipients = Array.isArray(to) ? to : [to];

    console.log(`[email-send] Sending email to ${recipients.length} recipient(s): ${subject}`);

    // Send via Resend
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader,
        to: recipients,
        subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: reply_to || EMAIL_CONFIG.replyTo,
      }),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error("[email-send] Resend API error:", resendResponse.status, errorText);
      throw new Error(`Resend API error: ${resendResponse.status} - ${errorText}`);
    }

    const resendData = await resendResponse.json();
    console.log("[email-send] Email sent successfully:", resendData.id);

    // Log to communication_history if tenant_id provided
    if (tenant_id) {
      try {
        await supabase.from("communication_history").insert({
          tenant_id,
          contact_id: contact_id || null,
          job_id: job_id || null,
          user_id: user_id || null,
          channel: "email",
          direction: "outbound",
          subject,
          content: html || text,
          status: "sent",
          external_id: resendData.id,
          metadata: {
            ...metadata,
            recipients,
            from: fromHeader,
            resend_id: resendData.id,
          },
        });
        console.log("[email-send] Logged to communication_history");
      } catch (logError) {
        console.error("[email-send] Failed to log communication:", logError);
        // Don't fail the request if logging fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: resendData.id,
        recipients,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[email-send] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
