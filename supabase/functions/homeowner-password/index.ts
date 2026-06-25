import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getContactForInviteToken(supabase: any, token: string, contactId?: string) {
  const now = new Date().toISOString();

  const { data: portalToken, error: portalTokenErr } = await supabase
    .from("customer_portal_tokens")
    .select("id, tenant_id, contact_id, expires_at")
    .eq("token", token)
    .gt("expires_at", now)
    .maybeSingle();

  if (portalTokenErr) console.error("customer_portal_tokens lookup error:", portalTokenErr);

  let tokenContactId = portalToken?.contact_id || null;

  if (!tokenContactId) {
    const { data: pendingSession, error: pendingSessionErr } = await supabase
      .from("homeowner_portal_sessions")
      .select("id, tenant_id, contact_id, email, expires_at, auth_method")
      .eq("token", token)
      .gt("expires_at", now)
      .maybeSingle();

    if (pendingSessionErr) console.error("homeowner_portal_sessions token lookup error:", pendingSessionErr);
    tokenContactId = pendingSession?.contact_id || null;
  }

  if (!tokenContactId) return { contact: null, error: "Invalid or expired invite link" };
  if (contactId && tokenContactId !== contactId) return { contact: null, error: "This invite link does not match this homeowner" };

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, tenant_id, email, phone, first_name, portal_password_hash, portal_access_enabled")
    .eq("id", tokenContactId)
    .maybeSingle();

  if (contactErr || !contact) return { contact: null, error: "Homeowner account not found" };
  if (!contact.portal_access_enabled) return { contact: null, error: "Portal access not enabled. Contact your project manager." };

  return { contact, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { action, contact_id, password, email, token } = await req.json();

    if (!action) return json({ error: "action required" }, 400);

    // ACTION: login — look up contact by email, verify password, create session
    if (action === "login") {
      if (!email || !password) return json({ error: "Email and password required" }, 400);

      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .select("id, tenant_id, email, first_name, portal_password_hash, portal_access_enabled")
        .ilike("email", email.trim())
        .maybeSingle();

      if (contactErr || !contact || !contact.portal_password_hash) return json({ error: "Invalid email or password" }, 401);
      if (!contact.portal_access_enabled) return json({ error: "Portal access not enabled. Contact your project manager." }, 403);

      const { compare } = await import("npm:bcryptjs@2.4.3");
      const valid = await compare(password, contact.portal_password_hash);
      if (!valid) return json({ error: "Invalid email or password" }, 401);

      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessionErr } = await supabase.from("homeowner_portal_sessions").insert({
        tenant_id: contact.tenant_id,
        contact_id: contact.id,
        token: sessionToken,
        email: contact.email,
        expires_at: expiresAt,
        auth_method: "password",
      });

      if (sessionErr) {
        console.error("session insert error:", sessionErr);
        return json({ error: "Failed to create session" }, 500);
      }

      await supabase.from("contacts").update({ portal_last_login_at: new Date().toISOString() }).eq("id", contact.id);

      return json({
        success: true,
        token: sessionToken,
        contact_id: contact.id,
        tenant_id: contact.tenant_id,
        email: contact.email,
        first_name: contact.first_name,
        expires_at: expiresAt,
      });
    }

    // ACTION: verify-invite — validate emailed setup link before password creation
    if (action === "verify-invite") {
      if (!token || typeof token !== "string") return json({ error: "Invite token required" }, 400);

      const { contact, error } = await getContactForInviteToken(supabase, token, contact_id);
      if (error || !contact) return json({ error: error || "Invalid invite link" }, 401);

      return json({
        success: true,
        contact: {
          id: contact.id,
          tenant_id: contact.tenant_id,
          email: contact.email,
          phone: contact.phone,
          first_name: contact.first_name,
          has_password: Boolean(contact.portal_password_hash),
        },
      });
    }

    if (!contact_id) return json({ error: "contact_id required" }, 400);

    // ACTION: set-password — validate invite token, hash password, store server-side, create login session
    if (action === "set-password") {
      if (!password || typeof password !== "string") return json({ error: "password required" }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (!/\d/.test(password)) return json({ error: "Password must contain at least one number" }, 400);
      if (!token || typeof token !== "string") return json({ error: "Valid invite link required" }, 400);

      const { contact, error: inviteErr } = await getContactForInviteToken(supabase, token, contact_id);
      if (inviteErr || !contact) return json({ error: inviteErr || "Invalid invite link" }, 401);

      const { hash } = await import("npm:bcryptjs@2.4.3");
      const passwordHash = await hash(password, 10);

      const { error: updateErr } = await supabase
        .from("contacts")
        .update({ portal_password_hash: passwordHash, portal_last_login_at: new Date().toISOString() })
        .eq("id", contact.id);

      if (updateErr) throw updateErr;

      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: sessionErr } = await supabase.from("homeowner_portal_sessions").insert({
        tenant_id: contact.tenant_id,
        contact_id: contact.id,
        token: sessionToken,
        email: contact.email,
        expires_at: expiresAt,
        auth_method: "password",
      });

      if (sessionErr) {
        console.error("session insert error:", sessionErr);
        return json({ error: "Password saved, but login session could not be created" }, 500);
      }

      return json({
        success: true,
        token: sessionToken,
        contact_id: contact.id,
        tenant_id: contact.tenant_id,
        email: contact.email,
        first_name: contact.first_name,
        expires_at: expiresAt,
      });
    }

    // ACTION: verify-password — check bcrypt hash server-side
    if (action === "verify-password") {
      if (!password || typeof password !== "string") return json({ error: "password required" }, 400);

      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .select("id, tenant_id, portal_password_hash, portal_access_enabled, email")
        .eq("id", contact_id)
        .single();

      if (contactErr || !contact || !contact.portal_password_hash) return json({ error: "Invalid credentials" }, 401);

      const { compare } = await import("npm:bcryptjs@2.4.3");
      const valid = await compare(password, contact.portal_password_hash);
      if (!valid) return json({ error: "Invalid credentials" }, 401);

      await supabase.from("contacts").update({ portal_last_login_at: new Date().toISOString() }).eq("id", contact_id);
      return json({ success: true, tenant_id: contact.tenant_id });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e: any) {
    console.error("homeowner-password error:", e);
    return json({ error: "An error occurred" }, 500);
  }
});
