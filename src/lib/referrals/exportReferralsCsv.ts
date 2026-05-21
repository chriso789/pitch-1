/**
 * CSV exporters for referral analytics.
 * Pure functions: caller is responsible for company/role-scoping the rows.
 */
import { format } from "date-fns";

function esc(v: any): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function fmtDate(v: any): string {
  if (!v) return "";
  try { return format(new Date(v), "yyyy-MM-dd HH:mm"); } catch { return String(v); }
}
function fmtMoney(v: any): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function exportReferralLinksCsv(rows: any[]): string {
  const headers = [
    "referral_code", "referrer_name", "source_job_id", "campaign_id", "status",
    "referral_url", "reward_url", "sends", "clicks", "unique_visitors",
    "leads", "sold", "completed", "created_at",
  ];
  return toCsv(headers, rows.map((r) => [
    r.referral_code ?? r.code, r.referrer_name, r.source_job_id, r.campaign_id,
    r.status ?? (r.is_active ? "active" : "inactive"),
    r.referral_url, r.reward_url, r.sends, r.clicks, r.unique_visitors,
    r.leads, r.sold, r.completed, fmtDate(r.created_at),
  ]));
}

export function exportReferralSubmissionsCsv(rows: any[]): string {
  const headers = [
    "created_at", "status", "referred_first_name", "referred_last_name",
    "referred_phone", "referred_email", "property_address", "city", "state", "zip",
    "service_needed", "preferred_contact_method", "referrer_name", "referral_code",
    "crm_lead_id", "crm_job_id", "estimated_value", "sold_value", "collected_revenue",
    "payout_eligible", "payout_eligibility_reason",
  ];
  return toCsv(headers, rows.map((r) => [
    fmtDate(r.created_at), r.status, r.referred_first_name, r.referred_last_name,
    r.referred_phone, r.referred_email, r.referred_property_address ?? r.property_address,
    r.referred_city ?? r.city, r.referred_state ?? r.state, r.referred_zip ?? r.zip,
    r.service_needed, r.preferred_contact_method, r.referrer_name, r.referral_code,
    r.crm_lead_id, r.crm_job_id,
    fmtMoney(r.estimated_value), fmtMoney(r.sold_value), fmtMoney(r.collected_revenue),
    r.payout_eligible, r.payout_eligibility_reason,
  ]));
}

export function exportReferralPayoutsCsv(rows: any[], includeHandles = false): string {
  const headers = [
    "created_at", "referrer_name", "referred_lead_name", "payout_method",
    "payout_amount", "payout_status", "approved_at", "paid_at",
    ...(includeHandles ? ["payment_reference"] : []),
    "notes",
  ];
  return toCsv(headers, rows.map((r) => [
    fmtDate(r.created_at ?? r.approvedAt ?? r.paidAt), r.referrerName ?? r.referrer_name,
    r.referredLeadName ?? r.referred_lead_name, r.payoutMethod ?? r.payout_method,
    fmtMoney(r.payoutAmount ?? r.payout_amount), r.payoutStatus ?? r.payout_status,
    fmtDate(r.approvedAt ?? r.approved_at), fmtDate(r.paidAt ?? r.paid_at),
    ...(includeHandles ? [r.paymentReference ?? r.payment_reference] : []),
    r.notes,
  ]));
}

export function exportReferralCreditsCsv(rows: any[]): string {
  const headers = [
    "referrer_name", "current_balance", "total_earned", "total_used",
    "total_adjusted", "total_expired", "last_activity_at",
  ];
  return toCsv(headers, rows.map((r) => [
    r.referrerName, fmtMoney(r.currentBalance), fmtMoney(r.totalEarned),
    fmtMoney(r.totalUsed), fmtMoney(r.totalAdjusted), fmtMoney(r.totalExpired),
    fmtDate(r.lastActivityAt),
  ]));
}

export function exportReferralEventsCsv(rows: any[], includeIpHash = false): string {
  const headers = [
    "created_at", "referral_code", "event_type", "visitor_id", "session_id",
    "device_type", "browser", "os", "city", "region", "country",
    "landing_url", "referrer_url",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "msclkid", "ttclid",
    ...(includeIpHash ? ["ip_hash"] : []),
  ];
  return toCsv(headers, rows.map((r) => [
    fmtDate(r.created_at), r.referral_code, r.event_type, r.visitor_id, r.session_id,
    r.device_type, r.browser, r.os, r.city, r.region, r.country,
    r.landing_url, r.referrer_url,
    r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.utm_term,
    r.fbclid, r.gclid, r.msclkid, r.ttclid,
    ...(includeIpHash ? [r.ip_hash] : []),
  ]));
}

export function exportReferralAnalyticsSummaryCsv(
  overview: Record<string, any>,
  filters: { dateFrom?: string; dateTo?: string } & Record<string, any>,
): string {
  const filtersApplied = Object.entries(filters)
    .filter(([k, v]) => v && !["dateFrom", "dateTo"].includes(k))
    .map(([k, v]) => `${k}=${v}`).join(" | ");
  const rows = Object.entries(overview).map(([k, v]) => [
    k, typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v ?? ""),
    filters.dateFrom ?? "", filters.dateTo ?? "", filtersApplied,
  ]);
  return toCsv(["metric", "value", "date_from", "date_to", "filters_applied"], rows);
}
