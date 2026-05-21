// CSV export helpers for the Company CRM Signup Referral System.
function escape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv<T extends Record<string, unknown>>(rows: T[], cols: (keyof T)[]): string {
  const head = cols.map((c) => escape(String(c))).join(",");
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
  return head + "\n" + body;
}

function download(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportCompanyReferralPartners(rows: any[]) {
  download(
    toCsv(rows, ["partner_code", "partner_name", "partner_type", "partner_email", "partner_phone", "status", "created_at"]),
    `company-referral-partners-${Date.now()}.csv`,
  );
}
export function exportCompanyReferralSignups(rows: any[]) {
  download(
    toCsv(rows, ["partner_code", "referred_company_name", "referred_owner_name", "referred_owner_email",
      "referred_owner_phone", "referred_company_trade", "signup_status", "selected_plan",
      "qualifying_revenue", "payout_eligible", "created_at"]),
    `company-referral-signups-${Date.now()}.csv`,
  );
}
export function exportCompanyReferralPayouts(rows: any[]) {
  download(
    toCsv(rows, ["partner_id", "referred_company_id", "payout_method", "payout_amount",
      "payout_status", "approved_at", "paid_at", "payment_reference", "notes", "created_at"]),
    `company-referral-payouts-${Date.now()}.csv`,
  );
}
export function exportCompanyReferralCredits(rows: any[]) {
  download(
    toCsv(rows, ["partner_id", "transaction_type", "amount", "balance_after", "notes", "created_at"]),
    `company-referral-credits-${Date.now()}.csv`,
  );
}
export function exportCompanyReferralAnalytics(data: Record<string, unknown>) {
  const rows = Object.entries(data).map(([metric, value]) => ({ metric, value }));
  download(toCsv(rows, ["metric", "value"]), `company-referral-analytics-${Date.now()}.csv`);
}
