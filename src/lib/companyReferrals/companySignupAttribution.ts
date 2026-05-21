// Glue between the signup/onboarding flow and the Company Referral attach endpoint.
//
// TODO(company-referrals-attribution): wire `attachCompanyReferralAfterSignup({ ... })`
// into the existing company-creation/onboarding edge function so newly created
// tenants automatically get attributed to the partner that referred them.
import { attachCrmReferralToNewCompany } from "./companyReferralApi";
import {
  getCompanyReferralAttribution,
  storeCompanyReferralAttribution,
  clearExpiredCompanyReferralAttribution,
} from "./companyReferralTracking";

export { storeCompanyReferralAttribution, getCompanyReferralAttribution, clearExpiredCompanyReferralAttribution };

export async function attachCompanyReferralAfterSignup(params: {
  referred_company_id: string;
  owner_user_id?: string;
  owner_email?: string;
  subscription_id?: string;
  payment_customer_id?: string;
  selected_plan?: string;
}) {
  const attribution = getCompanyReferralAttribution();
  if (!attribution && !params.owner_email) return { success: false, attributed: false, reason: "no_attribution" };
  try {
    const result = await attachCrmReferralToNewCompany({
      partner_code: attribution?.partner_code,
      visitor_id: attribution?.visitor_id,
      session_id: attribution?.session_id,
      ...params,
    });
    if (result.attributed) {
      try { localStorage.removeItem("crm_ref_attribution"); } catch { /* ignore */ }
    }
    return result;
  } catch (e) {
    return { success: false, attributed: false, reason: (e as Error).message };
  }
}
