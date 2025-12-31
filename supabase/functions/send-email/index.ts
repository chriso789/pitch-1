import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendEmailRequest {
  to: string[];
  subject: string;
  body: string;
  contactId?: string;
  cc?: string[];
  bcc?: string[];
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

    const { to, subject, body, contactId, cc, bcc }: SendEmailRequest = await req.json();

    if (!to || to.length === 0 || !subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get sender's profile for email signature
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email, company_name, tenant_id")
      .eq("id", user.id)
      .single();

    const repName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
    const repEmail = profile?.email || user.email;
    const companyName = profile?.company_name || "Your Company";
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";

    // Handle empty name to avoid malformed "from" field
    const fromAddress = repName 
      ? `${repName} <noreply@${fromDomain}>`
      : `noreply@${fromDomain}`;
    const replyTo = repEmail;

    console.log("Attempting to send email:", {
      from: fromAddress,
      to,
      subject,
      replyTo,
      fromDomain
    });

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: fromAddress,
      reply_to: replyTo,
      to,
      cc,
      bcc,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          ${body.replace(/\n/g, "<br>")}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0;"><strong>${repName}</strong></p>
            ${companyName ? `<p style="margin: 5px 0 0 0; color: #666;">${companyName}</p>` : ""}
            <p style="margin: 5px 0 0 0; color: #666;">${repEmail}</p>
          </div>
        </div>
      `,
    });

    // Check for Resend errors BEFORE returning success
    if (emailResponse.error) {
      console.error("Resend API error:", emailResponse.error);
      return new Response(
        JSON.stringify({
          error: "Email failed to send",
          details: emailResponse.error.message,
          code: emailResponse.error.name,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const resendMessageId = emailResponse.data?.id;
    console.log("Email sent successfully. Resend ID:", resendMessageId);

    // Log to communication history with resend_message_id for tracking
    if (contactId && profile?.tenant_id) {
      const { error: logError } = await supabase.from("communication_history").insert({
        tenant_id: profile.tenant_id,
        contact_id: contactId,
        communication_type: "email",
        direction: "outbound",
        subject,
        content: body,
        rep_id: user.id,
        resend_message_id: resendMessageId,
        email_status: "sent",
        metadata: {
          to,
          cc,
          bcc,
          email_id: resendMessageId,
        },
      });

      if (logError) {
        console.error("Failed to log email to communication_history:", logError);
      } else {
        console.log("Email logged with resend_message_id:", resendMessageId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email sent successfully",
        emailId: resendMessageId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-email function:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to send email",
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