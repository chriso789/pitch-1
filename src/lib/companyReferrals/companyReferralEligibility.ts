// Pure helpers for calculating payout eligibility + reward amounts.
export interface CompanyReferralSettings {
  default_reward_type?: string;
  fixed_signup_fee?: number;
  percentage_first_payment_rate?: number;
  recurring_percentage_rate?: number;
  recurring_months?: number;
  minimum_paid_amount?: number;
  payout_trigger?: string;
  max_rewards_per_partner_per_year?: number | null;
}

export interface CompanyReferralSignup {
  id: string;
  partner_id: string;
  signup_status?: string;
  qualifying_revenue?: number;
  active_paid_at?: string | null;
}

export function calculateCompanyReferralReward(
  signup: CompanyReferralSignup,
  settings: CompanyReferralSettings,
): number {
  const rev = Number(signup.qualifying_revenue || 0);
  switch (settings.default_reward_type) {
    case "percentage_first_payment":
      return rev * Number(settings.percentage_first_payment_rate || 0);
    case "recurring_percentage":
      return rev * Number(settings.recurring_percentage_rate || 0) * Number(settings.recurring_months || 1);
    case "fixed_signup_fee":
    default:
      return Number(settings.fixed_signup_fee ?? 500);
  }
}

export function calculateCompanyReferralEligibility(
  signup: CompanyReferralSignup,
  settings: CompanyReferralSettings,
  flags: { resolved?: boolean; severity?: string }[] = [],
  existingPayouts: { id: string; partner_id: string; created_at: string }[] = [],
): { eligible: boolean; reason: string; amount: number } {
  const amount = calculateCompanyReferralReward(signup, settings);
  if (signup.signup_status !== "active_paid") {
    return { eligible: false, reason: "not_active_paid", amount };
  }
  const minPaid = Number(settings.minimum_paid_amount ?? 0);
  if (Number(signup.qualifying_revenue || 0) < minPaid) {
    return { eligible: false, reason: `below_minimum_paid (${signup.qualifying_revenue} < ${minPaid})`, amount };
  }
  if (flags.some((f) => !f.resolved && (f.severity === "high" || f.severity === "critical"))) {
    return { eligible: false, reason: "unresolved_high_severity_flag", amount };
  }
  const cap = settings.max_rewards_per_partner_per_year;
  if (cap != null) {
    const since = Date.now() - 365 * 86400000;
    const recent = existingPayouts.filter((p) => p.partner_id === signup.partner_id && new Date(p.created_at).getTime() >= since);
    if (recent.length >= cap) return { eligible: false, reason: "annual_cap_reached", amount };
  }
  return { eligible: true, reason: "ok", amount };
}
