/**
 * Send Booking Invite
 * Emails a prospect a public booking link so they can pick a video meeting time.
 */
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://pitch-crm.ai";

function getFromEmail(): string {
  const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN");
  return fromDomain ? `demos@${fromDomain}` : "onboarding@resend.dev";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const { demo_request_id } = await req.json();
    if (!demo_request_id) throw new Error("demo_request_id is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: demo, error: demoError } = await supabase
      .from("demo_requests")
      .select("id, first_name, last_name, email, company_name, booking_token")
      .eq("id", demo_request_id)
      .single();

    if (demoError || !demo) throw new Error("Demo request not found");
    if (!demo.email) throw new Error("Demo request has no email");
    if (!demo.booking_token) throw new Error("Demo request has no booking token");

    const bookingUrl = `${APP_BASE_URL}/book-demo/${demo.booking_token}`;
    const firstName = demo.first_name || "there";

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background:#f6f7fb; margin:0; padding:24px;">
        <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <div style="background:linear-gradient(135deg,#667eea,#764ba2); padding:28px 32px;">
            <h1 style="color:#fff; margin:0; font-size:22px; font-weight:700;">
              <span style="background:#fde68a; color:#111; padding:2px 6px; border-radius:4px;">PITCH</span>
              <span style="background:#fde68a; color:#111; padding:2px 6px; border-radius:4px; margin-left:4px;">CRM</span>
              <span style="margin-left:8px;">Schedule Your Video Demo</span>
            </h1>
            <p style="color:rgba(255,255,255,0.9); margin:10px 0 0; font-size:14px;">
              Pick a time that works for you
            </p>
          </div>
          <div style="padding:28px 32px;">
            <p style="font-size:16px; color:#111; margin:0 0 16px;">Hi ${firstName},</p>
            <p style="font-size:15px; color:#444; line-height:1.6; margin:0 0 20px;">
              Thanks for your interest in PITCH CRM${demo.company_name ? ` for <strong>${demo.company_name}</strong>` : ""}!
              Click the button below to pick a date and time for a 30-minute video demo with our team.
            </p>
            <div style="text-align:center; margin:28px 0;">
              <a href="${bookingUrl}"
                 style="display:inline-block; background:#667eea; color:#fff; text-decoration:none;
                        padding:14px 28px; border-radius:8px; font-weight:600; font-size:15px;">
                📅 Pick Your Meeting Time
              </a>
            </div>
            <p style="font-size:13px; color:#666; line-height:1.5; margin:0 0 8px;">
              Or copy and paste this link into your browser:
            </p>
            <p style="font-size:13px; word-break:break-all; margin:0 0 24px;">
              <a href="${bookingUrl}" style="color:#667eea;">${bookingUrl}</a>
            </p>
            <div style="background:#eff6ff; border-left:4px solid #667eea; padding:14px 18px; border-radius:6px;">
              <p style="margin:0; font-size:13px; color:#1e3a8a; line-height:1.5;">
                <strong>What to expect:</strong> A 30-minute walkthrough of the platform tailored to your business.
                We'll send a Google Meet calendar invite once you confirm your time.
              </p>
            </div>
            <p style="margin:24px 0 0; font-size:13px; color:#888;">
              Questions? Reply to this email or write to <a href="mailto:support@pitch-crm.ai" style="color:#667eea;">support@pitch-crm.ai</a>.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const fromEmail = getFromEmail();
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `PITCH CRM <${fromEmail}>`,
        to: [demo.email],
        reply_to: "support@pitch-crm.ai",
        subject: `📅 Schedule your PITCH CRM video demo`,
        html,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[send-booking-invite] Resend error:", resp.status, errText);
      throw new Error(`Email failed: ${resp.status}`);
    }

    const result = await resp.json();
    await supabase
      .from("demo_requests")
      .update({ booking_token_sent_at: new Date().toISOString() })
      .eq("id", demo_request_id);

    return new Response(
      JSON.stringify({ success: true, email_id: result.id, booking_url: bookingUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[send-booking-invite] Error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
