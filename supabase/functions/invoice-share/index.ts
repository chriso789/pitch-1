// invoice-share
// Share a project_invoices invoice with a customer via email or SMS.
// Auth mode: authenticated tenant route (JWT required; tenant resolved from
// user's profile, not the request body). Attaches (as a link) the invoice PDF
// stored in the tenant-scoped `documents` bucket, plus optional QBO hosted
// payment link when present. Never emails/texts the raw QBO URL alone.
//
// Body: {
//   invoice_id: uuid,                    // project_invoices.id
//   channel: 'email' | 'sms',
//   recipient?: string,                  // optional override, else contact on file
//   message?: string,                    // optional short note prepended
//   include_qbo_link?: boolean,          // include QBO hosted link if available
// }

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { z } from "npm:zod@3.23.8";
import { getEmailProvider } from "../_shared/email/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") ?? "https://pitch-crm.ai").replace(/\/$/, "");
const PLATFORM_FALLBACK_FROM =
  Deno.env.get("PLATFORM_FALLBACK_FROM_EMAIL") ?? "invoices@pitch-crm.ai";

const BodySchema = z.object({
  invoice_id: z.string().uuid(),
  channel: z.enum(["email", "sms"]),
  recipient: z.string().trim().min(3).max(254).optional(),
  message: z.string().trim().max(500).optional(),
  include_qbo_link: z.boolean().optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isSafeHttpsUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try { const url = new URL(u); return url.protocol === "https:"; } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const correlationId = crypto.randomUUID();
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

  // 1) Auth
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // 2) Validate body
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_request", details: parsed.error.flatten().fieldErrors }, 400);
  }
  const { invoice_id, channel, recipient, message, include_qbo_link } = parsed.data;

  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 3) Load invoice from project_invoices (source of truth for pitch-created invoices)
  const { data: invoice } = await service
    .from("project_invoices")
    .select("id, tenant_id, pipeline_entry_id, invoice_number, amount, balance, due_date, status, notes")
    .eq("id", invoice_id)
    .maybeSingle();
  if (!invoice) return json({ ok: false, error: "invoice_not_found" }, 404);
  const tenantId = invoice.tenant_id as string;

  // 4) Verify user belongs to invoice tenant (direct member or master-impersonating)
  const [{ data: profile }, { data: accessRows }, { data: masterRow }] = await Promise.all([
    service.from("profiles").select("tenant_id, active_tenant_id").eq("id", userId).maybeSingle(),
    service.from("user_company_access").select("tenant_id").eq("user_id", userId),
    service.from("user_roles").select("role").eq("user_id", userId).eq("role", "master").maybeSingle(),
  ]);
  const memberTenants = new Set<string>([
    ...(profile?.tenant_id ? [profile.tenant_id] : []),
    ...((accessRows ?? []).map((r: any) => r.tenant_id).filter(Boolean)),
  ]);
  const isMaster = !!masterRow;
  const activeOverride = profile?.active_tenant_id ?? null;
  const authorized = memberTenants.has(tenantId) || (isMaster && activeOverride === tenantId);
  if (!authorized) return json({ ok: false, error: "forbidden" }, 403);

  // 5) Resolve contact via pipeline_entries
  const { data: pe } = await service
    .from("pipeline_entries")
    .select("contact_id")
    .eq("id", invoice.pipeline_entry_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const contactId = (pe as any)?.contact_id ?? null;
  let contact: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null = null;
  if (contactId) {
    const { data: c } = await service
      .from("contacts")
      .select("id, first_name, last_name, email, phone")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    contact = (c as any) ?? null;
  }

  // 6) Resolve recipient
  let target = (recipient ?? "").trim();
  if (!target) {
    target = channel === "email" ? (contact?.email ?? "").trim() : (contact?.phone ?? "").trim();
  }
  if (!target) {
    return json({ ok: false, error: channel === "email" ? "no_recipient_email" : "no_recipient_phone" }, 400);
  }

  // 7) Build the PDF signed URL (30 days). The stored path follows the same
  //    convention as generateAndSaveInvoicePdf: {tenant}/{pipeline}/invoices/{safeNumber}.pdf
  const safeNumber = String(invoice.invoice_number).replace(/[^A-Za-z0-9_-]/g, "_");
  const pdfPath = `${tenantId}/${invoice.pipeline_entry_id}/invoices/${safeNumber}.pdf`;
  let pdfUrl: string | null = null;
  const { data: signed } = await service.storage
    .from("documents")
    .createSignedUrl(pdfPath, 60 * 60 * 24 * 30);
  if (signed?.signedUrl) pdfUrl = signed.signedUrl;

  // 8) Optional QBO hosted link if the mirror row exists and is safe
  let qboLink: string | null = null;
  if (include_qbo_link) {
    const { data: mirror } = await service
      .from("invoice_ar_mirror")
      .select("invoice_link, invoice_link_status, qbo_status")
      .eq("tenant_id", tenantId)
      .eq("project_id", invoice.pipeline_entry_id)
      .eq("doc_number", invoice.invoice_number)
      .maybeSingle();
    if (
      mirror &&
      (mirror as any).invoice_link_status === "available" &&
      isSafeHttpsUrl((mirror as any).invoice_link) &&
      !["voided", "void"].includes(String((mirror as any).qbo_status ?? "").toLowerCase())
    ) {
      qboLink = (mirror as any).invoice_link as string;
    }
  }

  // 9) Load tenant branding
  const { data: tenantRow } = await service
    .from("tenants")
    .select("id, name, phone, email")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName = tenantRow?.name ?? "Pitch";

  const first = contact?.first_name?.trim() || "there";
  const total = Number(invoice.amount ?? 0);
  const balance = Number(invoice.balance ?? invoice.amount ?? 0);
  const due = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("en-US") : null;

  const primaryLink = qboLink || pdfUrl;
  if (!primaryLink) {
    return json({ ok: false, error: "no_deliverable_link", reason: "PDF has not been generated yet." }, 409);
  }

  // 10) Send via channel
  if (channel === "email") {
    const { data: settingsRow } = await service
      .from("tenant_email_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const sendingEnabled = (settingsRow as any)?.sending_enabled ?? true;
    if (!sendingEnabled) return json({ ok: false, error: "sending_disabled" }, 409);
    const verified = (settingsRow as any)?.verified_domain_status === "verified" && !!(settingsRow as any)?.from_email;
    const fromEmail = verified ? String((settingsRow as any).from_email) : PLATFORM_FALLBACK_FROM;
    const fromName = verified ? ((settingsRow as any).from_name ?? tenantName) : tenantName;
    const replyTo = (settingsRow as any)?.reply_to ?? tenantRow?.email ?? null;

    const subject = `Invoice ${invoice.invoice_number} from ${tenantName}`;
    const intro = message?.trim();
    const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <h2 style="margin:0 0 8px">Invoice ${invoice.invoice_number}</h2>
  <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
  ${intro ? `<p style="margin:0 0 16px">${intro.replace(/</g, "&lt;")}</p>` : ""}
  <p style="margin:0 0 16px">Your invoice from <strong>${tenantName}</strong> is ready.</p>
  <table style="border-collapse:collapse;margin:0 0 16px">
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Total</td><td style="font-weight:600">${money(total)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Balance</td><td style="font-weight:600">${money(balance)}</td></tr>
    ${due ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Due</td><td>${due}</td></tr>` : ""}
  </table>
  <p style="margin:16px 0">
    <a href="${primaryLink}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">
      ${qboLink ? "Pay Invoice" : "View Invoice PDF"}
    </a>
  </p>
  ${qboLink && pdfUrl ? `<p style="margin:8px 0;font-size:13px"><a href="${pdfUrl}" style="color:#334155">Download PDF</a></p>` : ""}
  <p style="margin:24px 0 0;color:#64748b;font-size:12px">Sent by ${tenantName}${tenantRow?.phone ? ` · ${tenantRow.phone}` : ""}</p>
</div>`.trim();
    const text = [
      `Hi ${first},`,
      intro || `Your invoice from ${tenantName} is ready.`,
      `Invoice: ${invoice.invoice_number}`,
      `Total: ${money(total)}  Balance: ${money(balance)}`,
      due ? `Due: ${due}` : "",
      `Open: ${primaryLink}`,
      qboLink && pdfUrl ? `PDF: ${pdfUrl}` : "",
      `— ${tenantName}`,
    ].filter(Boolean).join("\n");

    const provider = getEmailProvider("resend");
    const idempotencyKey = `share:${invoice.id}:${target}:${Date.now()}`;
    const result = await provider.sendInvoiceEmail({
      to: target, fromEmail, fromName, replyTo, subject, html, text, idempotencyKey,
      tags: [
        { name: "kind", value: "invoice_share" },
        { name: "tenant_id", value: tenantId },
      ],
    });

    // Audit
    await service.from("audit_log").insert({
      tenant_id: tenantId,
      table_name: "project_invoices",
      record_id: invoice.id,
      action: "invoice.share.email",
      new_values: {
        correlation_id: correlationId,
        recipient: target,
        sender_kind: verified ? "tenant_verified" : "platform_fallback",
        provider_message_id: result.providerMessageId ?? null,
        ok: result.ok,
        error: result.ok ? null : (result.errorMessage ?? "provider_error"),
        included_qbo_link: !!qboLink,
      } as any,
      changed_by: userId,
    }).then(() => {}, () => {});

    if (!result.ok) {
      return json({ ok: false, error: "email_send_failed", reason: result.errorMessage ?? "provider_error" }, 502);
    }
    return json({ ok: true, channel: "email", to: target, provider_message_id: result.providerMessageId });
  }

  // channel === 'sms'
  const introSms = message?.trim();
  const smsBody = [
    introSms || `${tenantName}: Invoice ${invoice.invoice_number}`,
    `Balance ${money(balance)}${due ? ` due ${due}` : ""}`,
    primaryLink,
  ].join(" — ");

  const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      to: target,
      message: smsBody,
      contactId: contact?.id ?? undefined,
      tenant_id: tenantId,
      sent_by: userId,
    }),
  });
  const smsJson = await smsRes.json().catch(() => ({} as any));
  const smsOk = smsRes.ok && smsJson?.success !== false;

  await service.from("audit_log").insert({
    tenant_id: tenantId,
    table_name: "project_invoices",
    record_id: invoice.id,
    action: "invoice.share.sms",
    new_values: {
      correlation_id: correlationId,
      recipient: target,
      ok: smsOk,
      status: smsRes.status,
      error: smsOk ? null : (smsJson?.error ?? smsJson?.message ?? `status_${smsRes.status}`),
      included_qbo_link: !!qboLink,
    } as any,
    changed_by: userId,
  }).then(() => {}, () => {});

  if (!smsOk) {
    return json({ ok: false, error: "sms_send_failed", status: smsRes.status, reason: smsJson?.error ?? smsJson?.message ?? "telnyx_error" }, 502);
  }
  return json({ ok: true, channel: "sms", to: target });
});
