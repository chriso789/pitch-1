import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendSMSRequest {
  to: string;
  message: string;
  contactId?: string;
  jobId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { to, message, contactId, jobId }: SendSMSRequest = await req.json();

    if (!to || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, message" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user's profile for tenant_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, first_name, last_name")
      .eq("id", user.id)
      .single();

    // Normalize phone number to E.164 format
    const normalizePhone = (phone: string): string => {
      const cleaned = phone.replace(/\D/g, "");
      return cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
    };

    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      console.error("Twilio credentials not configured");
      
      // Log the attempt even if Twilio not configured
      await supabase.from("communication_history").insert({
        tenant_id: profile?.tenant_id,
        contact_id: contactId,
        communication_type: "sms",
        direction: "outbound",
        content: message,
        rep_id: user.id,
        metadata: {
          to: normalizePhone(to),
          from: twilioPhoneNumber || "N/A",
          status: "failed",
          error: "Twilio not configured",
        },
      });

      return new Response(
        JSON.stringify({
          error: "SMS service not configured. Contact administrator.",
        }),
        { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const toNumber = normalizePhone(to);
    const fromNumber = normalizePhone(twilioPhoneNumber);

    // Send SMS via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const formData = new URLSearchParams({
      From: fromNumber,
      To: toNumber,
      Body: message,
    });

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    const twilioData = await twilioResponse.json();

    // Log to communication history
    if (profile?.tenant_id) {
      await supabase.from("communication_history").insert({
        tenant_id: profile.tenant_id,
        contact_id: contactId,
        communication_type: "sms",
        direction: "outbound",
        content: message,
        rep_id: user.id,
        metadata: {
          to: toNumber,
          from: fromNumber,
          provider: "Twilio",
          provider_id: twilioData.sid,
          status: twilioResponse.ok ? "sent" : "failed",
          error: twilioResponse.ok ? null : JSON.stringify(twilioData),
        },
      });
    }

    console.log("SMS sent:", { sid: twilioData.sid, to: toNumber, status: twilioData.status });

    return new Response(
      JSON.stringify({
        success: twilioResponse.ok,
        sid: twilioData.sid,
        status: twilioData.status,
        message: twilioResponse.ok ? "SMS sent successfully" : "SMS failed to send",
      }),
      {
        status: twilioResponse.ok ? 200 : 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-sms function:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to send SMS",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
