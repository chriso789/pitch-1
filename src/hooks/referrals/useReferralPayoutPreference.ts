import { useEffect, useState } from "react";
import { getPublicReferralRewardProfile, saveReferralPayoutPreference } from "@/lib/referrals/api";
import { useReferralTracking } from "./useReferralTracking";

export function useReferralPayoutPreference(referralCode: string | null | undefined) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { track } = useReferralTracking(referralCode);

  useEffect(() => {
    let cancelled = false;
    if (!referralCode) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const data = await getPublicReferralRewardProfile(referralCode);
        if (!cancelled) {
          setProfile(data);
          track("payout_choice_started");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [referralCode, track]);

  async function save(payload: Record<string, unknown>) {
    if (!referralCode) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveReferralPayoutPreference({ ...payload, referral_code: referralCode });
      track("payout_choice_saved", { method: payload.preferred_payout_method });
      return res;
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  return { profile, loading, saving, error, save };
}
