import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, contact_id, password, verification_value, email } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: login — look up contact by email, verify password, create session
    if (action === "login") {
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "Email and password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .select("id, tenant_id, email, first_name, portal_password_hash, portal_access_enabled")
        .ilike("email", email.trim())
        .maybeSingle();

      if (contactErr || !contact || !contact.portal_password_hash) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!contact.portal_access_enabled) {
        return new Response(JSON.stringify({ error: "Portal access not enabled. Contact your project manager." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { compare } = await import("npm:bcryptjs@2.4.3");
      const valid = await compare(password, contact.portal_password_hash);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessionErr } = await supabase
        .from("homeowner_portal_sessions")
        .insert({
          tenant_id: contact.tenant_id,
          contact_id: contact.id,
          token: sessionToken,
          email: contact.email,
          expires_at: expiresAt,
          auth_method: "password",
        });

      if (sessionErr) {
        console.error("session insert error:", sessionErr);
        return new Response(JSON.stringify({ error: "Failed to create session" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase
        .from("contacts")
        .update({ portal_last_login_at: new Date().toISOString() })
        .eq("id", contact.id);

      return new Response(
        JSON.stringify({
          success: true,
          token: sessionToken,
          contact_id: contact.id,
          tenant_id: contact.tenant_id,
          email: contact.email,
          first_name: contact.first_name,
          expires_at: expiresAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!contact_id) {
      return new Response(JSON.stringify({ error: "contact_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: set-password — hash with bcrypt and store server-side
    if (action === "set-password") {
      if (!password || typeof password !== "string") {
        return new Response(JSON.stringify({ error: "password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (password.length < 8) {
        return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!/\d/.test(password)) {
        return new Response(JSON.stringify({ error: "Password must contain at least one number" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify contact exists and has portal access
      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .select("id, tenant_id, portal_access_enabled")
        .eq("id", contact_id)
        .single();

      if (contactErr || !contact) {
        return new Response(JSON.stringify({ error: "Contact not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!contact.portal_access_enabled) {
        return new Response(JSON.stringify({ error: "Portal access not enabled" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Hash with bcrypt via Web Crypto + salt
      const { hash } = await import("npm:bcryptjs@2.4.3");
      const passwordHash = await hash(password);

      const { error: updateErr } = await supabase
        .from("contacts")
        .update({
          portal_password_hash: passwordHash,
          portal_last_login_at: new Date().toISOString(),
        })
        .eq("id", contact_id);

      if (updateErr) throw updateErr;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: verify-password — check bcrypt hash server-side
    if (action === "verify-password") {
      if (!password || typeof password !== "string") {
        return new Response(JSON.stringify({ error: "password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .select("id, tenant_id, portal_password_hash, portal_access_enabled, email")
        .eq("id", contact_id)
        .single();

      if (contactErr || !contact || !contact.portal_password_hash) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { compare } = await import("npm:bcryptjs@2.4.3");
      const valid = await compare(password, contact.portal_password_hash);

      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update last login
      await supabase
        .from("contacts")
        .update({ portal_last_login_at: new Date().toISOString() })
        .eq("id", contact_id);

      return new Response(JSON.stringify({ success: true, tenant_id: contact.tenant_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("homeowner-password error:", e);
    return new Response(JSON.stringify({ error: "An error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
