import { useCallback, useEffect, useRef } from "react";
import { trackReferralEvent } from "@/lib/referrals/api";
import { getReferralTrackingParams } from "@/lib/referrals/url";
import {
  getOrCreateReferralSessionId,
  getOrCreateReferralVisitorId,
} from "@/lib/referrals/visitor";

export function useReferralTracking(referralCode: string | null | undefined) {
  const visitorId = useRef<string>("");
  const sessionId = useRef<string>("");

  useEffect(() => {
    visitorId.current = getOrCreateReferralVisitorId();
    sessionId.current = getOrCreateReferralSessionId();
  }, []);

  const track = useCallback(
    async (eventType: string, metadata: Record<string, unknown> = {}) => {
      if (!referralCode) return;
      try {
        await trackReferralEvent({
          referral_code: referralCode,
          event_type: eventType,
          visitor_id: visitorId.current,
          session_id: sessionId.current,
          landing_url: typeof window !== "undefined" ? window.location.href : undefined,
          referrer_url: typeof document !== "undefined" ? document.referrer : undefined,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          ...getReferralTrackingParams(),
          metadata,
        });
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[useReferralTracking]", e);
      }
    },
    [referralCode],
  );

  return { track, visitorId: visitorId.current, sessionId: sessionId.current };
}
