export const BUYOUT_STATUSES = ["not_started", "pricing", "rfq_sent", "quotes_received", "under_review", "approved", "committed", "complete"] as const;
export const BUYOUT_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", pricing: "Pricing", rfq_sent: "RFQ sent", quotes_received: "Quotes received",
  under_review: "Under review", approved: "Approved", committed: "Committed", complete: "Complete",
};
export const RFQ_VENDOR_STATUSES = ["invited", "sent", "viewed", "responded", "declined"] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Buyout gain = estimate − committed. Falls back to the selected quote before anything is committed. */
export function buyoutGain(estimated: number, committed: number, selected: number | null): { value: number | null; basis: "committed" | "selected" | null } {
  if (committed > 0) return { value: r2(estimated - committed), basis: "committed" };
  if (selected != null) return { value: r2(estimated - selected), basis: "selected" };
  return { value: null, basis: null };
}

/** Adjusted comparison total used for bid leveling (mirrors the DB generated column). */
export const adjustedTotal = (q: { amount?: any; freight?: any; tax?: any; alternates_amount?: any }) =>
  r2(Number(q.amount || 0) + Number(q.freight || 0) + Number(q.tax || 0) + Number(q.alternates_amount || 0));
