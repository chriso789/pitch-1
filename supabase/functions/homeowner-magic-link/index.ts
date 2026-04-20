// ============================================
// HOMEOWNER MAGIC LINK
// Securely issues a homeowner portal session link via email.
// - Never reveals whether the email is on file
// - Creates a short-lived (15 min) one-time token, marked unverified
// - Session is only activated when the link is clicked & verified server-side
// ============================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = (await req.json()) as { email?: string };
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return json({ ok: true }); // Don't leak validation
    }

    const normalizedEmail = email.trim().toLowerCase();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up contact server-side (RLS bypassed safely via service role)
    const { data: contact } = await admin
      .from("contacts")
      .select("id, first_name, tenant_id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // Always return ok=true to prevent email enumeration
    if (!contact) {
      console.log(`[homeowner-magic-link] No contact for ${normalizedEmail}`);
      return json({ ok: true });
    }

    // Create a short-lived (15 minute) magic-link token
    const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin
      .from("homeowner_portal_sessions")
      .insert({
        tenant_id: contact.tenant_id,
        contact_id: contact.id,
        token,
        email: normalizedEmail,
        expires_at: expiresAt,
        auth_method: "magic_link_pending",
      });

    if (insertErr) {
      console.error("[homeowner-magic-link] insert error:", insertErr.message);
      return json({ ok: true });
    }

    // Build magic link URL — points to a verification page that activates the session
    const origin = req.headers.get("origin") || "https://pitch-crm.ai";
    const magicLink = `${origin}/homeowner/verify?token=${encodeURIComponent(token)}`;

    // Send email via Resend if configured; otherwise log
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const fromAddr = Deno.env.get("RESEND_FROM") ||
        "Pitch Construction CRM <noreply@pitch-crm.ai>";
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [normalizedEmail],
            subject: "Your secure sign-in link",
            html: `
              <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;">
                <h2>Sign in to your project portal</h2>
                <p>Hi ${contact.first_name || "there"},</p>
                <p>Click the button below to securely access your project portal. This link expires in <strong>15 minutes</strong>.</p>
                <p style="text-align:center;margin:32px 0;">
                  <a href="${magicLink}" style="background:#10b981;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in to my portal</a>
                </p>
                <p style="color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
              </div>
            `,
          }),
        });
        if (!r.ok) {
          console.error("[homeowner-magic-link] resend error:", await r.text());
        }
      } catch (e) {
        console.error("[homeowner-magic-link] resend send failed:", e);
      }
    } else {
      console.log(`[homeowner-magic-link] (no RESEND_API_KEY) link: ${magicLink}`);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[homeowner-magic-link] error:", e);
    return json({ ok: true }); // Don't leak errors
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
