// Phase 2 Slice B — invoice-email-send
// Sends an invoice email via the provider abstraction using the secure
// Slice A portal URL. NEVER emails the raw QBO hosted URL.
//
// Guarantees:
//  - tenant, invoice, recipient, portal token — all resolved server-side
//  - idempotent on (tenant_id, idempotency_key)
//  - authorized-role gated
//  - suppression check on recent bounce/complaint
//
// verify_jwt is enforced by supabase/config.toml (default true for undeclared).

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { z } from "npm:zod@3.23.8";
import { getEmailProvider } from "../_shared/email/index.ts";
import { renderInvoiceEmail } from "../_shared/email/invoice-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://pitch-crm.ai";
const PLATFORM_FALLBACK_FROM =
  Deno.env.get("PLATFORM_FALLBACK_FROM_EMAIL") ?? "invoices@pitch-crm.ai";
const TEMPLATE_VERSION = 1;
const AUTHORIZED_ROLES = new Set([
  "master",
  "owner",
  "corporate",
  "office_admin",
]);

const BodySchema = z.object({
  invoice_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  recipient_email: z.string().trim().email().max(254).optional(),
  send_request_id: z.string().trim().min(8).max(64).optional(),
  is_resend: z.boolean().optional(),
  override_suppression: z.boolean().optional(),
  confirm_recipient_override: z.boolean().optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // 1. Resolve authenticated user.
  const { data: userRes, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userRes?.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const userId = userRes.user.id;

  // 2. Parse & validate body.
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json(
      { ok: false, error: "invalid_request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const {
    invoice_id, contact_id, recipient_email: bodyRecipient,
    send_request_id, is_resend, override_suppression, confirm_recipient_override,
  } = parsed.data;

  // 3. Resolve caller's tenant + role server-side (never trust body).
  const { data: tenantIdRow } = await supabase.rpc("get_user_tenant_id", {
    _user_id: userId,
  });
  const tenantId = (tenantIdRow as string | null) ?? null;
  if (!tenantId) return json({ ok: false, error: "no_tenant" }, 403);

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = new Set(((roleRows as { role: string }[] | null) ?? []).map((r) => r.role));
  const isAuthorized = [...roles].some((r) => AUTHORIZED_ROLES.has(r));
  if (!isAuthorized) return json({ ok: false, error: "forbidden_role" }, 403);

  // 4. Load invoice + verify tenant match.
  const { data: inv } = await supabase
    .from("invoice_ar_mirror")
    .select(
      "id, tenant_id, project_id, doc_number, qbo_invoice_id, total_amount, balance, qbo_status, txn_date, due_date, paid_at, invoice_type",
    )
    .eq("id", invoice_id)
    .maybeSingle();
  if (!inv || inv.tenant_id !== tenantId) {
    return json({ ok: false, error: "invoice_not_found" }, 404);
  }

  // 5. Load contact + verify tenant + project association.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, tenant_id, first_name, last_name, email")
    .eq("id", contact_id)
    .maybeSingle();
  if (!contact || contact.tenant_id !== tenantId) {
    return json({ ok: false, error: "contact_not_in_tenant" }, 403);
  }

  // Ensure contact belongs to this project (via pipeline_entries link).
  let contactBelongsToProject = false;
  if (inv.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, tenant_id, pipeline_entry_id, name")
      .eq("id", inv.project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (project?.pipeline_entry_id) {
      const { data: pe } = await supabase
        .from("pipeline_entries")
        .select("contact_id, tenant_id")
        .eq("id", project.pipeline_entry_id)
        .maybeSingle();
      if (pe?.tenant_id === tenantId && pe.contact_id === contact.id) {
        contactBelongsToProject = true;
      }
    }
  }
  if (!contactBelongsToProject) {
    return json({ ok: false, error: "contact_not_on_project" }, 403);
  }

  // 6. Resolve recipient email.
  const recipient = (bodyRecipient ?? contact.email ?? "").trim().toLowerCase();
  if (!recipient) return json({ ok: false, error: "no_recipient_email" }, 400);
  // If recipient differs from contact's on-file email, require explicit confirmation.
  const contactEmailLower = (contact.email ?? "").trim().toLowerCase();
  if (contactEmailLower && recipient !== contactEmailLower && !confirm_recipient_override) {
    return json({
      ok: false,
      error: "recipient_override_requires_confirmation",
      contact_email: contact.email,
      requested_email: recipient,
    }, 409);
  }

  // 7. Suppression check — most recent delivery for this tenant+recipient.
  const { data: recentDelivs } = await supabase
    .from("invoice_email_deliveries")
    .select("id, status, complained_at, bounced_at")
    .eq("tenant_id", tenantId)
    .ilike("recipient_email", recipient)
    .order("created_at", { ascending: false })
    .limit(5);
  const isSuppressed = ((recentDelivs as any[] | null) ?? []).some(
    (d) => d.status === "bounced" || d.status === "complained",
  );
  if (isSuppressed && !override_suppression) {
    return json({
      ok: false,
      error: "recipient_suppressed",
      reason: "prior bounce or complaint on this address",
    }, 409);
  }

  // 8. Load tenant branding + sender settings.
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("id, name, logo_url, primary_color, phone, email")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenantRow) return json({ ok: false, error: "tenant_missing" }, 500);

  const { data: settingsRow } = await supabase
    .from("tenant_email_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const sendingEnabled = settingsRow?.sending_enabled ?? true;
  if (!sendingEnabled) return json({ ok: false, error: "sending_disabled" }, 409);

  const verifiedTenantSender =
    settingsRow?.verified_domain_status === "verified" &&
    !!settingsRow?.from_email;

  let fromEmail: string;
  let fromName: string | null;
  let senderKind: "tenant_verified" | "platform_fallback";
  if (verifiedTenantSender) {
    fromEmail = String(settingsRow!.from_email);
    fromName = settingsRow?.from_name ?? tenantRow.name;
    senderKind = "tenant_verified";
  } else if (settingsRow?.platform_sender_fallback_enabled !== false) {
    fromEmail = PLATFORM_FALLBACK_FROM;
    fromName = tenantRow.name;
    senderKind = "platform_fallback";
  } else {
    return json({ ok: false, error: "no_verified_sender" }, 409);
  }
  const replyTo = settingsRow?.reply_to ?? tenantRow.email ?? null;

  // 9. Resolve or create a portal token (Slice A). Prefer active un-revoked
  //    token; else mint a new one.
  const { data: activeTokRow } = await supabase
    .from("invoice_portal_tokens")
    .select("id, expires_at")
    .eq("tenant_id", tenantId)
    .eq("pitch_invoice_id", inv.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let portalTokenId: string;
  let portalPlaintext: string | null = null;
  if (activeTokRow) {
    portalTokenId = activeTokRow.id;
  } else {
    portalPlaintext = randomToken(32);
    const hash = await sha256Hex(portalPlaintext);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: newTok, error: newTokErr } = await supabase
      .from("invoice_portal_tokens")
      .insert({
        tenant_id: tenantId,
        project_id: inv.project_id,
        pitch_invoice_id: inv.id,
        contact_id: contact.id,
        token_hash: hash,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id")
      .single();
    if (newTokErr || !newTok) {
      return json({ ok: false, error: "portal_token_create_failed" }, 500);
    }
    portalTokenId = newTok.id;
    await supabase.from("customer_invoice_events").insert({
      tenant_id: tenantId,
      project_id: inv.project_id,
      pitch_invoice_id: inv.id,
      contact_id: contact.id,
      portal_token_id: portalTokenId,
      event_type: "invoice_portal_link_created",
      actor_type: "staff",
      actor_user_id: userId,
      metadata: { origin: "invoice-email-send" },
    });
  }

  // We can only email a plaintext token if we just minted it. For reuse, we
  // never have the plaintext — the client must have copied it earlier, OR we
  // rotate: revoke the reused one and mint a fresh one when sending email.
  if (!portalPlaintext) {
    // Rotate on send so we can email a fresh plaintext token (plaintext is
    // NEVER stored — only its sha256 hash).
    await supabase
      .from("invoice_portal_tokens")
      .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
      .eq("id", portalTokenId);
    portalPlaintext = randomToken(32);
    const hash = await sha256Hex(portalPlaintext);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rotated, error: rotErr } = await supabase
      .from("invoice_portal_tokens")
      .insert({
        tenant_id: tenantId,
        project_id: inv.project_id,
        pitch_invoice_id: inv.id,
        contact_id: contact.id,
        token_hash: hash,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id")
      .single();
    if (rotErr || !rotated) {
      return json({ ok: false, error: "portal_token_rotate_failed" }, 500);
    }
    portalTokenId = rotated.id;
  }

  const portalUrl = `${APP_URL.replace(/\/$/, "")}/invoice/${portalPlaintext}`;

  // 10. Idempotency: hash of stable fields + send_request_id.
  const reqId = send_request_id ?? `auto-${randomToken(8)}`;
  const idempotencyBasis = [
    tenantId, inv.id, recipient, TEMPLATE_VERSION, reqId, is_resend ? "resend" : "send",
  ].join("|");
  const idempotencyKey = await sha256Hex(idempotencyBasis);

  const balance = Number(inv.balance ?? 0);
  const total = Number(inv.total_amount ?? 0);
  const isPaid = balance <= 0 && total > 0 && String(inv.qbo_status ?? "").toLowerCase() === "paid";
  const isVoid = ["voided", "void"].includes(String(inv.qbo_status ?? "").toLowerCase());
  const invoiceNumber = inv.doc_number ?? inv.qbo_invoice_id ?? inv.id.slice(0, 8);

  const rendered = renderInvoiceEmail({
    tenantName: tenantRow.name,
    tenantPhone: tenantRow.phone,
    tenantEmail: tenantRow.email,
    tenantPrimaryColor: tenantRow.primary_color,
    customerFirstName: contact.first_name ?? "",
    invoiceNumber,
    projectAddress: null, // avoid leaking internal project name; portal shows full detail
    formattedTotal: money(total),
    formattedBalance: money(balance),
    formattedDueDate: inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-US") : null,
    portalUrl,
    isPaid,
    isVoid,
  });

  // 11. Insert delivery row (idempotent via UNIQUE constraint).
  const insertRes = await supabase
    .from("invoice_email_deliveries")
    .insert({
      tenant_id: tenantId,
      project_id: inv.project_id,
      pitch_invoice_id: inv.id,
      portal_token_id: portalTokenId,
      contact_id: contact.id,
      recipient_email: recipient,
      from_email: fromEmail,
      from_name: fromName,
      reply_to: replyTo,
      sender_kind: senderKind,
      provider: "resend",
      send_request_id: reqId,
      idempotency_key: idempotencyKey,
      template_version: TEMPLATE_VERSION,
      subject: rendered.subject,
      status: "queued",
      is_resend: !!is_resend,
      created_by: userId,
    })
    .select("id")
    .maybeSingle();

  let deliveryId: string;
  if (insertRes.error) {
    // Conflict on idempotency_key -> return existing row.
    if (String(insertRes.error.code) === "23505") {
      const { data: existing } = await supabase
        .from("invoice_email_deliveries")
        .select("id, status, provider_message_id, created_at")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      return json({
        ok: true,
        deduplicated: true,
        delivery: existing,
      }, 200);
    }
    console.error("invoice-email-send insert failed", insertRes.error);
    return json({ ok: false, error: "delivery_persist_failed" }, 500);
  }
  deliveryId = insertRes.data!.id;

  await supabase.from("customer_invoice_events").insert({
    tenant_id: tenantId,
    project_id: inv.project_id,
    pitch_invoice_id: inv.id,
    contact_id: contact.id,
    portal_token_id: portalTokenId,
    event_type: is_resend ? "invoice_email_resent" : "invoice_email_queued",
    actor_type: "staff",
    actor_user_id: userId,
    delivery_provider: "resend",
    metadata: { delivery_id: deliveryId, sender_kind: senderKind },
  });

  // 12. Send through provider.
  const provider = getEmailProvider("resend");
  const result = await provider.sendInvoiceEmail({
    to: recipient,
    fromEmail,
    fromName,
    replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
    tags: [
      { name: "kind", value: "invoice" },
      { name: "tenant_id", value: tenantId },
      { name: "delivery_id", value: deliveryId },
    ],
  });

  if (result.ok) {
    await supabase
      .from("invoice_email_deliveries")
      .update({
        status: "accepted",
        provider_message_id: result.providerMessageId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);
    await supabase.from("customer_invoice_events").insert({
      tenant_id: tenantId,
      project_id: inv.project_id,
      pitch_invoice_id: inv.id,
      contact_id: contact.id,
      portal_token_id: portalTokenId,
      event_type: "invoice_email_accepted",
      actor_type: "system",
      delivery_provider: "resend",
      delivery_provider_message_id: result.providerMessageId ?? null,
      metadata: { delivery_id: deliveryId },
    });
    return json({
      ok: true,
      delivery: {
        id: deliveryId,
        status: "accepted",
        provider_message_id: result.providerMessageId,
        recipient_email: recipient,
        sender_kind: senderKind,
      },
    }, 200);
  }

  // Failure path.
  await supabase
    .from("invoice_email_deliveries")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: result.errorMessage ?? "provider_error",
    })
    .eq("id", deliveryId);
  await supabase.from("customer_invoice_events").insert({
    tenant_id: tenantId,
    project_id: inv.project_id,
    pitch_invoice_id: inv.id,
    contact_id: contact.id,
    portal_token_id: portalTokenId,
    event_type: "invoice_email_failed",
    actor_type: "system",
    delivery_provider: "resend",
    metadata: {
      delivery_id: deliveryId,
      failure_class: result.failureClass,
      http_status: result.httpStatus,
    },
  });
  return json({
    ok: false,
    delivery: { id: deliveryId, status: "failed" },
    error: "provider_send_failed",
    reason: result.errorMessage ?? "provider_error",
    failure_class: result.failureClass ?? "unknown",
  }, 502);
});
