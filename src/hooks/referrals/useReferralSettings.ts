import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import * as api from "@/lib/referrals/adminApi";
import { toast } from "sonner";

const DEFAULTS = {
  is_enabled: true,
  default_reward_type: "fixed_amount",
  fixed_reward_amount: 250,
  percentage_reward_rate: 0,
  minimum_collected_revenue: 0,
  payout_trigger: "job_paid",
  allow_stored_balance: true,
  allow_venmo: true,
  allow_zelle: true,
  allow_gift_card: true,
  require_admin_approval: true,
  duplicate_window_days: 180,
  block_self_referrals: true,
  max_rewards_per_referrer_per_year: 0,
  terms_text: "",
};

export function useReferralSettings() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["referral-settings", tenantId],
    queryFn: () => api.getReferralSettings(tenantId!),
    enabled: !!tenantId,
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, any>) => api.saveReferralSettings(tenantId!, payload),
    onSuccess: () => {
      toast.success("Referral settings saved");
      queryClient.invalidateQueries({ queryKey: ["referral-settings", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save settings"),
  });

  return { ...query, save, defaults: DEFAULTS };
}
