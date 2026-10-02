export const PROCUREMENT_STATUSES = ["pricing", "submittal_required", "submittal_pending", "approved", "ordered", "manufacturing", "shipped", "delivered", "complete", "cancelled"] as const;
export const PO_STATUSES = ["draft", "pending_approval", "approved", "issued", "partially_received", "received", "closed", "cancelled"] as const;
export const SUB_STATUSES = ["draft", "pending_approval", "approved", "issued", "closed", "cancelled"] as const;
export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const DAY = 86_400_000;
const d = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`).getTime() : null);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Expected delivery from stored facts only: actual delivery → stored expected delivery →
 * PO date + vendor lead time. Returns null when none exist (no speculation).
 */
export function expectedDelivery(i: { delivery_date?: string | null; received_date?: string | null; expected_delivery_date?: string | null; po_date?: string | null; lead_time_days?: number | null }) {
  if (i.received_date) return { date: i.received_date, basis: "received" as const };
  if (i.delivery_date) return { date: i.delivery_date, basis: "delivered" as const };
  if (i.expected_delivery_date) return { date: i.expected_delivery_date, basis: "vendor" as const };
  const po = d(i.po_date);
  if (po != null && i.lead_time_days != null) return { date: iso(po + i.lead_time_days * DAY), basis: "lead_time" as const };
  return null;
}

/** Days the item lands after it is needed onsite (positive = late). Null when unknown. */
export function daysAtRisk(i: Parameters<typeof expectedDelivery>[0] & { required_onsite_date?: string | null; status?: string }, today = new Date()) {
  const req = d(i.required_onsite_date);
  if (req == null || i.status === "complete" || i.status === "cancelled") return null;
  const exp = expectedDelivery(i);
  if (exp) return Math.round((d(exp.date)! - req) / DAY);
  // Not ordered and no lead time: only flag once the need date has passed
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return t > req ? Math.round((t - req) / DAY) : null;
}
