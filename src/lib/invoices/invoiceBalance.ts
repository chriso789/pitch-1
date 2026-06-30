// Pure helpers for computing the remaining contract balance and scaling
// invoice line-item groups to that balance. Extracted so the Create Invoice
// default logic can be unit-tested in isolation and reused by Accounts
// Receivable.
//
// Rules:
// 1. "Remaining" = contract selling price − recorded payments (net of
//    pass-through credit-card fees) − the balance of any non-void
//    outstanding invoices.
// 2. The default invoice amount NEVER exceeds the remaining balance unless
//    the user explicitly opts into an override.
// 3. Scaling preserves the structure of trade + change-order groups so the
//    builder dialog still shows a sensible breakdown; a final penny
//    adjustment guarantees the scaled total equals the target exactly.

export interface InvoiceLineItemLike {
  description?: string;
  qty?: number;
  unit?: string;
  unit_cost?: number;
  line_total?: number;
  selected?: boolean;
  [key: string]: any;
}

export interface InvoiceGroupLike {
  key: string;
  kind: 'trade' | 'change_order' | 'custom';
  label: string;
  selected: boolean;
  expanded?: boolean;
  children: InvoiceLineItemLike[];
}

export interface PaymentLike {
  amount?: number | string | null;
  cc_fee_amount?: number | string | null;
}

export interface InvoiceLike {
  status?: string | null;
  amount?: number | string | null;
  balance?: number | string | null;
}

export interface RemainingBalanceInput {
  sellingPrice: number | string | null | undefined;
  payments?: PaymentLike[] | null;
  outstandingInvoices?: InvoiceLike[] | null;
}

/** Sum of recorded payments, excluding pass-through CC processing fees. */
export function sumRecordedPayments(payments: PaymentLike[] | null | undefined): number {
  if (!payments?.length) return 0;
  return payments.reduce((sum, p) => {
    const amount = Number(p?.amount || 0);
    const fee = Number(p?.cc_fee_amount || 0);
    return sum + Math.max(0, amount - fee);
  }, 0);
}

/** Sum of outstanding invoice balances (status !== 'void'). */
export function sumOutstandingInvoices(invoices: InvoiceLike[] | null | undefined): number {
  if (!invoices?.length) return 0;
  return invoices
    .filter((inv) => (inv?.status ?? '') !== 'void')
    .reduce((sum, inv) => {
      const balance = inv?.balance ?? inv?.amount ?? 0;
      return sum + Number(balance || 0);
    }, 0);
}

/**
 * Compute the remaining contract balance that a new invoice should default to.
 * Clamped at 0 so a fully (or over-) paid contract returns 0, not a negative.
 */
export function computeRemainingInvoiceBalance(input: RemainingBalanceInput): number {
  const contract = Math.max(0, Number(input.sellingPrice || 0));
  const paid = sumRecordedPayments(input.payments);
  const outstanding = sumOutstandingInvoices(input.outstandingInvoices);
  const remaining = contract - paid - outstanding;
  return Math.max(0, Math.round(remaining * 100) / 100);
}

const sumGroupTotal = (g: InvoiceGroupLike) =>
  g.children.filter((c) => c.selected).reduce((s, c) => s + (Number(c.line_total) || 0), 0);

/**
 * Scale the selected children of every group so their combined total equals
 * `targetBalance`. Preserves group/child structure; unselected items are
 * untouched. Applies a final penny adjustment to the last selected child so
 * floating-point rounding never drifts off the target.
 *
 * When `targetBalance >= currentTotal`, groups are returned unchanged
 * (we never upsize the default — the user must edit manually if they want
 * to bill more than the remaining balance).
 */
export function scaleGroupsToInvoiceBalance<G extends InvoiceGroupLike>(
  groups: G[],
  targetBalance: number,
): G[] {
  const sourceTotal = groups.reduce((sum, g) => sum + sumGroupTotal(g), 0);
  const target = Math.max(0, Math.round((targetBalance || 0) * 100) / 100);

  if (sourceTotal <= 0) return groups;
  if (target >= sourceTotal) return groups;

  const scale = target === 0 ? 0 : target / sourceTotal;
  let runningTotal = 0;
  let lastSelected: { groupIndex: number; childIndex: number } | null = null;

  const scaled = groups.map((group, groupIndex) => ({
    ...group,
    children: group.children.map((item, childIndex) => {
      if (!item.selected) return item;
      lastSelected = { groupIndex, childIndex };
      const lineTotal = Math.round((Number(item.line_total) || 0) * scale * 100) / 100;
      runningTotal += lineTotal;
      const qty = Number(item.qty) || 1;
      return {
        ...item,
        line_total: lineTotal,
        unit_cost: qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : lineTotal,
      };
    }),
  })) as G[];

  const pennyAdjustment = Math.round((target - runningTotal) * 100) / 100;
  if (lastSelected && pennyAdjustment !== 0) {
    const { groupIndex, childIndex } = lastSelected;
    const item = scaled[groupIndex].children[childIndex];
    const lineTotal = Math.max(
      0,
      Math.round((Number(item.line_total) + pennyAdjustment) * 100) / 100,
    );
    const qty = Number(item.qty) || 1;
    scaled[groupIndex].children[childIndex] = {
      ...item,
      line_total: lineTotal,
      unit_cost: qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : lineTotal,
    } as InvoiceLineItemLike;
  }

  return scaled;
}

/** Total of all currently-selected children across all selected groups. */
export function selectedGroupsTotal(groups: InvoiceGroupLike[]): number {
  return groups
    .filter((g) => g.selected)
    .reduce((sum, g) => sum + sumGroupTotal(g), 0);
}

/**
 * Validation gate for the Create Invoice dialog: the proposed invoice
 * amount may not exceed the remaining balance unless the user explicitly
 * toggles the override.
 */
export function validateInvoiceAgainstRemaining(params: {
  proposedTotal: number;
  remainingBalance: number;
  overrideRemaining: boolean;
}): { ok: true } | { ok: false; reason: 'exceeds_remaining'; overBy: number } {
  const { proposedTotal, remainingBalance, overrideRemaining } = params;
  if (overrideRemaining) return { ok: true };
  const overBy = Math.round((proposedTotal - remainingBalance) * 100) / 100;
  if (overBy > 0.01) {
    return { ok: false, reason: 'exceeds_remaining', overBy };
  }
  return { ok: true };
}
