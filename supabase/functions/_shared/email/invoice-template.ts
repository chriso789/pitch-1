// Default invoice email template (v1). Tenant-branded, no internal IDs, no raw
// QBO URLs, no cost/margin/commission/supplier/labor detail. CTA points ONLY
// to the secure Pitch portal URL.

export interface InvoiceEmailTemplateInput {
  tenantName: string;
  tenantPhone?: string | null;
  tenantEmail?: string | null;
  tenantPrimaryColor?: string | null;
  customerFirstName: string;
  invoiceNumber: string;
  projectAddress?: string | null;
  formattedTotal: string;
  formattedBalance: string;
  formattedDueDate: string | null;
  portalUrl: string; // Pitch /invoice/<token> — NEVER raw QBO url
  isPaid: boolean;
  isVoid: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

export function renderInvoiceEmail(input: InvoiceEmailTemplateInput): RenderedEmail {
  const {
    tenantName, tenantPhone, tenantEmail, tenantPrimaryColor,
    customerFirstName, invoiceNumber, projectAddress,
    formattedTotal, formattedBalance, formattedDueDate,
    portalUrl, isPaid, isVoid,
  } = input;

  const brandColor = tenantPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(tenantPrimaryColor)
    ? tenantPrimaryColor
    : "#1e3a8a";

  const ctaLabel = isPaid ? "View Paid Invoice" : "View and Pay Invoice";
  const showPaymentAction = !isPaid && !isVoid;

  const subject = isPaid
    ? `Receipt for invoice ${invoiceNumber} from ${tenantName}`
    : `Invoice ${invoiceNumber} from ${tenantName}`;

  const salutation = customerFirstName?.trim()
    ? `Hello ${customerFirstName.trim()},`
    : `Hello,`;

  const addressLine = projectAddress ? escapeHtml(projectAddress) : null;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:${brandColor};padding:20px 24px;color:#ffffff;font-size:18px;font-weight:600;">
          ${escapeHtml(tenantName)}
        </td></tr>
        <tr><td style="padding:28px 24px 8px 24px;font-size:16px;line-height:1.5;">
          <p style="margin:0 0 16px 0;">${escapeHtml(salutation)}</p>
          <p style="margin:0 0 16px 0;">Your invoice${addressLine ? ` for ${addressLine}` : ""} is ready.</p>
        </td></tr>
        <tr><td style="padding:0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;">
            <tr><td style="padding:12px 16px;font-size:14px;color:#374151;">Invoice</td>
                <td style="padding:12px 16px;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(invoiceNumber)}</td></tr>
            <tr><td style="padding:12px 16px;font-size:14px;color:#374151;border-top:1px solid #e5e7eb;">Total</td>
                <td style="padding:12px 16px;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #e5e7eb;">${escapeHtml(formattedTotal)}</td></tr>
            <tr><td style="padding:12px 16px;font-size:14px;color:#374151;border-top:1px solid #e5e7eb;">Balance due</td>
                <td style="padding:12px 16px;font-size:14px;text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">${escapeHtml(formattedBalance)}</td></tr>
            ${formattedDueDate ? `<tr><td style="padding:12px 16px;font-size:14px;color:#374151;border-top:1px solid #e5e7eb;">Due date</td>
                <td style="padding:12px 16px;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #e5e7eb;">${escapeHtml(formattedDueDate)}</td></tr>` : ""}
          </table>
        </td></tr>
        <tr><td align="center" style="padding:24px;">
          <a href="${escapeHtml(portalUrl)}" role="button" aria-label="${escapeHtml(ctaLabel)}"
             style="display:inline-block;background:${brandColor};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;font-weight:600;">
            ${escapeHtml(ctaLabel)}
          </a>
          ${showPaymentAction ? `<p style="margin:12px 0 0 0;font-size:12px;color:#6b7280;">Secure link — pay online, view balance, or download a copy.</p>` : ""}
        </td></tr>
        <tr><td style="padding:8px 24px 24px 24px;font-size:14px;color:#374151;line-height:1.5;">
          <p style="margin:0 0 12px 0;">Questions? Contact us${tenantPhone ? ` at ${escapeHtml(tenantPhone)}` : ""}${tenantEmail ? ` or <a href="mailto:${escapeHtml(tenantEmail)}" style="color:${brandColor};">${escapeHtml(tenantEmail)}</a>` : ""}.</p>
          <p style="margin:0;">Thank you,<br>${escapeHtml(tenantName)}</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:12px 24px;font-size:11px;color:#9ca3af;text-align:center;">
          This is a secure invoice link. Do not forward.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    salutation,
    "",
    `Your invoice${addressLine ? ` for ${projectAddress}` : ""} is ready.`,
    "",
    `Invoice: ${invoiceNumber}`,
    `Total: ${formattedTotal}`,
    `Balance due: ${formattedBalance}`,
    formattedDueDate ? `Due date: ${formattedDueDate}` : "",
    "",
    `${ctaLabel}: ${portalUrl}`,
    "",
    `Questions? Contact us${tenantPhone ? ` at ${tenantPhone}` : ""}${tenantEmail ? ` or ${tenantEmail}` : ""}.`,
    "",
    `Thank you,`,
    tenantName,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}
