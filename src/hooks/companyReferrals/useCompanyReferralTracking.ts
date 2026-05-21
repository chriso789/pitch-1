import { useCallback } from "react";
import { trackCrmReferralEvent } from "@/lib/companyReferrals/companyReferralApi";
import {
  getOrCreateCrmReferralVisitorId, getOrCreateCrmReferralSessionId, getCrmReferralTrackingParams,
} from "@/lib/companyReferrals/companyReferralTracking";

export function useCompanyReferralTracking(partnerCode?: string) {
  return useCallback(
    async (event_type: string, extra: Record<string, unknown> = {}) => {
      if (!partnerCode) return;
      try {
        await trackCrmReferralEvent({
          partner_code: partnerCode,
          event_type,
          visitor_id: getOrCreateCrmReferralVisitorId(),
          session_id: getOrCreateCrmReferralSessionId(),
          landing_url: typeof window !== "undefined" ? window.location.href : undefined,
          referrer_url: typeof document !== "undefined" ? document.referrer : undefined,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          ...getCrmReferralTrackingParams(),
          ...extra,
        });
      } catch { /* fire-and-forget */ }
    },
    [partnerCode],
  );
}
