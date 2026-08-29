// Shared helper: notify the rep (sender) every time a homeowner opens or views
// a quote / document. Sends an in-app notification, an SMS from the company's
// number, and an email from the company's verified sending domain.
import { Resend } from "npm:resend@2.0.0";

interface NotifyArgs {
  supabase: any;
  tenantId: string;
  userId: string | null | undefined;
  title: string;
  /** Short line used for in-app + SMS */
  message: string;
  /** Email subject (defaults to title) */
  emailSubject?: string;
  /** Extra HTML detail lines for the email body */
  detailLines?: string[];
  /** Optional CTA link */
  actionUrl?: string | null;
  type: string;
  metadata?: Record<string, unknown>;
}

async function resolveRepContact(supabase: any, userId: string) {
  let phone: string | null = null;
  let email: string | null = null;
  let firstName: string | null = null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone, email, first_name")
    .eq("id", userId)
    .maybeSingle();

  phone = profile?.phone || null;
  email = profile?.email || null;
  firstName = profile?.first_name || null;

  if (!phone || !email) {
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      phone = phone || authUser?.user?.phone ||
        (authUser?.user?.user_metadata?.phone as string | undefined) || null;
      email = email || authUser?.user?.email || null;
    } catch (_e) { /* ignore */ }
  }

  return { phone, email, firstName };
}

export async function notifySenderEngagement(args: NotifyArgs): Promise<void> {
  const {
    supabase, tenantId, userId, title, message,
    emailSubject, detailLines = [], actionUrl, type, metadata = {},
  } = args;

  if (!userId) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) In-app notification
  try {
    await supabase.from("user_notifications").insert({
      tenant_id: tenantId,
      user_id: userId,
      title,
      message,
      type,
      priority: "high",
      metadata,
    });
  } catch (e) {
    console.error("[engagement-notify] in-app insert failed", e);
  }

  const { phone, email, firstName } = await resolveRepContact(supabase, userId);

  // 2) SMS from the company's number (telnyx-send-sms resolves the tenant number)
  if (phone) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/telnyx-send-sms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: phone,
          message: actionUrl ? `${message}\n${actionUrl}` : message,
          tenant_id: tenantId,
          sent_by: userId,
        }),
      });
      if (!resp.ok) {
        console.error("[engagement-notify] SMS failed", resp.status, await resp.text());
      }
    } catch (e) {
      console.error("[engagement-notify] SMS error", e);
    }
  } else {
    console.log("[engagement-notify] no phone on file for rep", userId);
  }

  // 3) Email from the company's verified domain
  if (email) {
    try {
      const apiKey = Deno.env.get("RESEND_API_KEY");
      if (!apiKey) {
        console.log("[engagement-notify] RESEND_API_KEY missing, email skipped");
        return;
      }
      const resend = new Resend(apiKey);

      const [{ data: tenant }, { data: emailDomain }] = await Promise.all([
        supabase.from("tenants").select("name, primary_color").eq("id", tenantId).maybeSingle(),
        supabase
          .from("company_email_domains")
          .select("from_email, from_name, reply_to_email")
          .eq("tenant_id", tenantId)
          .eq("verification_status", "verified")
          .eq("is_active", true)
          .maybeSingle(),
      ]);

      const companyName = tenant?.name || "Pitch CRM";
      const accent = tenant?.primary_color || "#f97316";
      const defaultFromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
      const fromEmail = emailDomain?.from_email || `notifications@${defaultFromDomain}`;
      const fromName = emailDomain?.from_name || companyName;

      const html = `
<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:${accent};padding:20px 28px;">
      <h1 style="margin:0;color:#ffffff;font-size:18px;">${title}</h1>
    </td></tr>
    <tr><td style="padding:24px 28px;color:#111827;">
      <p style="margin:0 0 12px;font-size:16px;">${firstName ? `Hi ${firstName},` : "Hi,"}</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${message}</p>
      ${detailLines.length ? `<ul style="margin:0 0 16px;padding-left:18px;color:#4b5563;font-size:14px;line-height:1.6;">${detailLines.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
      ${actionUrl ? `<p style="margin:20px 0 0;"><a href="${actionUrl}" style="background:${accent};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;display:inline-block;">View in ${companyName}</a></p>` : ""}
    </td></tr>
    <tr><td style="background:#1a1a2e;padding:16px 28px;text-align:center;color:#9ca3af;font-size:12px;">
      Sent automatically by ${companyName}
    </td></tr>
  </table>
</body></html>`;

      await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: [email],
        ...(emailDomain?.reply_to_email ? { reply_to: emailDomain.reply_to_email } : {}),
        subject: emailSubject || title,
        html,
      });
    } catch (e) {
      console.error("[engagement-notify] email error", e);
    }
  }
}
