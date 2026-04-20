// ============================================
// HOMEOWNER MAGIC LINK VERIFY
// Activates a pending magic-link session token (one-time use)
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
    const { token } = (await req.json()) as { token?: string };
    if (!token || typeof token !== "string" || token.length < 16) {
      return json({ ok: false, error: "Invalid token" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: session, error } = await admin
      .from("homeowner_portal_sessions")
      .select("id, tenant_id, contact_id, email, expires_at, auth_method")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error || !session) {
      return json({ ok: false, error: "Invalid or expired link" }, 401);
    }

    if (session.auth_method !== "magic_link_pending" && session.auth_method !== "magic_link") {
      return json({ ok: false, error: "Link already used" }, 401);
    }

    // Activate the session and extend expiry to 24 hours
    const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await admin
      .from("homeowner_portal_sessions")
      .update({
        auth_method: "magic_link",
        expires_at: newExpiresAt,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    return json({
      ok: true,
      session: {
        token,
        contactId: session.contact_id,
        tenantId: session.tenant_id,
        email: session.email,
        expiresAt: newExpiresAt,
      },
    });
  } catch (e) {
    console.error("[homeowner-magic-link-verify] error:", e);
    return json({ ok: false, error: "Verification failed" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
