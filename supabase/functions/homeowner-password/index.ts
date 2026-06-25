import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import bcrypt from "npm:bcryptjs@2.4.3";
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

async function getValidHomeownerSession(supabase: any, token: string) {
  const { data: session, error: sessionErr } = await supabase
    .from("homeowner_portal_sessions")
    .select("id, tenant_id, contact_id, email, expires_at, auth_method, contact:contacts(id, tenant_id, email, phone, first_name, last_name, portal_access_enabled)")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionErr) {
    console.error("homeowner session lookup error:", sessionErr);
    return { session: null, contact: null, error: "Unable to validate session" };
  }

  const contact = Array.isArray(session?.contact) ? session.contact[0] : session?.contact;
  if (!session || !contact?.portal_access_enabled) {
    return { session: null, contact: null, error: "Invalid or expired session" };
  }

  return { session, contact, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action, contact_id, password, email, token, project_id, message, change_order_id } = body;
    const { file_base64, file_name, mime_type, caption } = body as {
      file_base64?: string; file_name?: string; mime_type?: string; caption?: string;
    };

    if (!action) return json({ error: "action required" }, 400);


    // ACTION: validate-session — validate homeowner local session server-side
    if (action === "validate-session") {
      if (!token || typeof token !== "string") return json({ error: "Session token required" }, 400);

      const { session, contact, error } = await getValidHomeownerSession(supabase, token);
      if (error || !session || !contact) return json({ error: error || "Invalid or expired session" }, 401);

      await supabase
        .from("homeowner_portal_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", session.id);

      return json({
        success: true,
        token,
        contact_id: session.contact_id,
        tenant_id: session.tenant_id,
        email: session.email || contact.email,
        first_name: contact.first_name,
        expires_at: session.expires_at,
      });
    }

    // ACTION: portal-data — load homeowner portal data server-side for custom homeowner sessions
    if (action === "portal-data") {
      if (!token || typeof token !== "string") return json({ error: "Session token required" }, 400);

      const { session, contact, error } = await getValidHomeownerSession(supabase, token);
      if (error || !session || !contact) return json({ error: error || "Invalid or expired session" }, 401);

      await supabase
        .from("homeowner_portal_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", session.id);

      const { data: pipelineRows } = await supabase
        .from("pipeline_entries")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("tenant_id", session.tenant_id)
        .order("created_at", { ascending: false });

      const pipelineIds = (pipelineRows || []).map((row: any) => row.id);
      const { data: projectData } = pipelineIds.length > 0
        ? await supabase
            .from("projects")
            .select("*")
            .in("pipeline_entry_id", pipelineIds)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null as any };

      let project = null;
      let photos: any[] = [];
      let changeOrders: any[] = [];
      let messages: any[] = [];
      let payments: any[] = [];

      if (projectData) {
        let contractAmount = Number(projectData.total_contract_value) || 0;
        let amountPaid = 0;

        if (projectData.pipeline_entry_id) {
          const { data: barData } = await supabase.rpc("api_estimate_hyperlink_bar", {
            p_pipeline_entry_id: projectData.pipeline_entry_id,
          });
          const bar = barData as { sale_price?: number } | null;
          if (!contractAmount && bar?.sale_price) contractAmount = Number(bar.sale_price) || 0;

          const { data: paymentRows } = await supabase
            .from("project_payments")
            .select("id, amount, status, created_at, payment_date, description")
            .eq("pipeline_entry_id", projectData.pipeline_entry_id)
            .order("created_at", { ascending: false });
          payments = paymentRows || [];
          amountPaid = payments.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
        }

        project = {
          id: projectData.id,
          name: projectData.name,
          status: projectData.status,
          start_date: projectData.start_date,
          end_date: projectData.actual_completion_date || projectData.target_completion_date,
          progress_percentage: projectData.progress_percentage || 0,
          contract_amount: contractAmount,
          amount_paid: amountPaid,
          address: projectData.property_address || "Address not set",
        };

        const { data: photoRows } = await supabase
          .from("project_photos")
          .select("id, storage_path, url, ai_description, phase, created_at")
          .eq("project_id", projectData.id)
          .order("created_at", { ascending: false });
        photos = (photoRows || []).map((photo: any) => ({
          id: photo.id,
          url: photo.storage_path || photo.url,
          caption: photo.ai_description || "",
          category: photo.phase || "progress",
          created_at: photo.created_at,
        }));

        const { data: coRows } = await supabase
          .from("change_orders")
          .select("id, title, description, cost_impact, status, created_at")
          .eq("project_id", projectData.id)
          .order("created_at", { ascending: false });
        changeOrders = coRows || [];

        const { data: msgRows } = await supabase
          .from("portal_messages")
          .select("id, message, sender_type, created_at")
          .eq("project_id", projectData.id)
          .order("created_at", { ascending: false });
        messages = msgRows || [];
      }

      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id, name, logo_url, phone, email, website, brand_primary_color, brand_accent_color, primary_color, secondary_color, address_street, address_city, address_state, address_zip")
        .eq("id", session.tenant_id)
        .maybeSingle();

      return json({
        success: true,
        contact,
        company: tenantRow || null,
        project,
        photos,
        changeOrders,
        messages,
        payments,
        documents: [],
      });
    }

    // ACTION: upload-photo — homeowner uploads a photo to the project (base64 payload)
    if (action === "upload-photo") {
      if (!token || typeof token !== "string") return json({ error: "Session token required" }, 400);
      if (!project_id || typeof project_id !== "string") return json({ error: "Project required" }, 400);
      if (!file_base64 || typeof file_base64 !== "string") return json({ error: "file_base64 required" }, 400);

      const { session, contact, error } = await getValidHomeownerSession(supabase, token);
      if (error || !session || !contact) return json({ error: error || "Invalid or expired session" }, 401);

      // Confirm project belongs to homeowner's contact + tenant
      const { data: proj } = await supabase
        .from("projects")
        .select("id, tenant_id, pipeline_entry_id")
        .eq("id", project_id)
        .eq("tenant_id", session.tenant_id)
        .maybeSingle();
      if (!proj) return json({ error: "Project not found" }, 404);

      try {
        const cleanedBase64 = file_base64.includes(",") ? file_base64.split(",")[1] : file_base64;
        const binary = Uint8Array.from(atob(cleanedBase64), (c) => c.charCodeAt(0));
        const safeName = (file_name || `photo-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${session.tenant_id}/projects/${project_id}/homeowner/${Date.now()}-${safeName}`;
        const contentType = mime_type || "image/jpeg";

        const { error: uploadErr } = await supabase.storage
          .from("customer-photos")
          .upload(path, binary, { contentType, upsert: false });
        if (uploadErr) {
          console.error("homeowner photo upload error:", uploadErr);
          return json({ error: "Unable to upload photo" }, 500);
        }

        const { data: publicUrl } = supabase.storage.from("customer-photos").getPublicUrl(path);

        const { error: insertErr } = await supabase.from("project_photos").insert({
          tenant_id: session.tenant_id,
          project_id,
          filename: safeName,
          storage_path: publicUrl?.publicUrl || path,
          mime_type: contentType,
          file_size: binary.length,
          ai_description: caption || `Uploaded by homeowner ${contact.first_name || ""}`.trim(),
          workflow_status: "homeowner_upload",
          uploaded_by: contact.id,
        });

        if (insertErr) {
          console.error("project_photos insert error:", insertErr);
          return json({ error: "Photo saved but could not be recorded" }, 500);
        }

        return json({ success: true });
      } catch (uploadEx: any) {
        console.error("upload-photo exception:", uploadEx);
        return json({ error: "Upload failed" }, 500);
      }
    }

    if (action === "send-message") {
      if (!token || typeof token !== "string") return json({ error: "Session token required" }, 400);
      if (!message || typeof message !== "string" || !message.trim()) return json({ error: "Message required" }, 400);
      if (!project_id || typeof project_id !== "string") return json({ error: "Project required" }, 400);

      const { session, contact, error } = await getValidHomeownerSession(supabase, token);
      if (error || !session || !contact) return json({ error: error || "Invalid or expired session" }, 401);

      const { error: msgErr } = await supabase.from("portal_messages").insert({
        tenant_id: session.tenant_id,
        project_id,
        sender_type: "homeowner",
        sender_id: contact.id,
        recipient_type: "admin",
        message: message.trim(),
      });

      if (msgErr) {
        console.error("portal message insert error:", msgErr);
        return json({ error: "Unable to send message" }, 500);
      }

      return json({ success: true });
    }

    // ACTION: approve-change-order — allow a homeowner session to approve a pending change order
    if (action === "approve-change-order") {
      if (!token || typeof token !== "string") return json({ error: "Session token required" }, 400);
      if (!change_order_id || typeof change_order_id !== "string") return json({ error: "Change order required" }, 400);

      const { session, error } = await getValidHomeownerSession(supabase, token);
      if (error || !session) return json({ error: error || "Invalid or expired session" }, 401);

      const { error: updateErr } = await supabase
        .from("change_orders")
        .update({ customer_approved: true, customer_approved_at: new Date().toISOString() })
        .eq("id", change_order_id)
        .eq("tenant_id", session.tenant_id);

      if (updateErr) {
        console.error("change order approval error:", updateErr);
        return json({ error: "Unable to approve change order" }, 500);
      }

      return json({ success: true });
    }

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

      const valid = bcrypt.compareSync(password, contact.portal_password_hash);
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

      const passwordHash = bcrypt.hashSync(password, 10);

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

      const valid = bcrypt.compareSync(password, contact.portal_password_hash);
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
