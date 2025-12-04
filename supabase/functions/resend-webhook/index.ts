import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    click?: {
      link: string;
      timestamp: string;
      userAgent: string;
      ipAddress: string;
    };
    open?: {
      timestamp: string;
      userAgent: string;
      ipAddress: string;
    };
    bounce?: {
      message: string;
    };
  };
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: ResendWebhookPayload = await req.json();
    console.log("Resend webhook received:", payload.type, payload.data?.email_id);

    const emailId = payload.data?.email_id;
    const eventType = payload.type.replace("email.", ""); // "email.opened" -> "opened"
    const emailAddress = payload.data?.to?.[0];

    // Map Resend event types to our schema
    const eventTypeMap: Record<string, string> = {
      "delivered": "delivered",
      "opened": "opened",
      "clicked": "clicked",
      "bounced": "bounced",
      "complained": "complained",
    };

    const mappedEventType = eventTypeMap[eventType];
    if (!mappedEventType) {
      console.log("Unhandled event type:", eventType);
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the tenant_id from onboarding_email_log
    const { data: emailLog } = await supabase
      .from("onboarding_email_log")
      .select("tenant_id, id")
      .eq("resend_message_id", emailId)
      .single();

    // Insert engagement event
    const { error: insertError } = await supabase
      .from("email_engagement_events")
      .insert({
        tenant_id: emailLog?.tenant_id || null,
        resend_message_id: emailId,
        email_type: "onboarding",
        event_type: mappedEventType,
        email_address: emailAddress,
        link_url: payload.data?.click?.link || null,
        user_agent: payload.data?.click?.userAgent || payload.data?.open?.userAgent || null,
        ip_address: payload.data?.click?.ipAddress || payload.data?.open?.ipAddress || null,
        timestamp: payload.created_at,
        raw_payload: payload as unknown as Record<string, unknown>,
      });

    if (insertError) {
      console.error("Failed to insert engagement event:", insertError);
    }

    // Update aggregate counts in onboarding_email_log
    if (emailLog?.id) {
      const updateData: Record<string, unknown> = {};
      
      if (mappedEventType === "opened") {
        updateData.opens_count = (emailLog as any).opens_count + 1 || 1;
        updateData.last_opened_at = new Date().toISOString();
      } else if (mappedEventType === "clicked") {
        updateData.clicks_count = (emailLog as any).clicks_count + 1 || 1;
        updateData.last_clicked_at = new Date().toISOString();
      } else if (mappedEventType === "delivered") {
        updateData.delivered_at = new Date().toISOString();
        updateData.status = "delivered";
      } else if (mappedEventType === "bounced") {
        updateData.bounced_at = new Date().toISOString();
        updateData.status = "bounced";
      }

      if (Object.keys(updateData).length > 0) {
        // Use raw SQL increment for counts
        if (mappedEventType === "opened" || mappedEventType === "clicked") {
          const countField = mappedEventType === "opened" ? "opens_count" : "clicks_count";
          const timestampField = mappedEventType === "opened" ? "last_opened_at" : "last_clicked_at";
          
          await supabase.rpc("increment_email_count", {
            p_log_id: emailLog.id,
            p_count_field: countField,
            p_timestamp_field: timestampField,
          }).catch(() => {
            // Fallback to direct update if RPC doesn't exist
            supabase
              .from("onboarding_email_log")
              .update({ [timestampField]: new Date().toISOString() })
              .eq("id", emailLog.id);
          });
        } else {
          await supabase
            .from("onboarding_email_log")
            .update(updateData)
            .eq("id", emailLog.id);
        }
      }
    }

    console.log(`Processed ${mappedEventType} event for email ${emailId}`);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Resend webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
