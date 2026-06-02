// Typed discriminated union for supplier price state.
// Every supplier-pricing UI must consume `SupplierPriceState` rather than
// raw `unit_price: number | null`. This prevents the long-standing bug where
// a contract-zero or "no contract" response was silently rendered as $0.00.

export type SupplierKind = 'abc' | 'srs' | 'qxo';

export type SupplierPriceState =
  | { kind: 'unmapped'; reason?: string }
  | { kind: 'pending'; reason?: string }
  | { kind: 'locked'; reason: AbcLockReason }
  | {
      kind: 'priced';
      unitPrice: number;
      uom: string | null;
      currency: string;
      observedAt: string;
    }
  | {
      kind: 'zero';
      reason: 'contract_zero' | 'no_contract' | 'unknown';
    }
  | {
      // Distinct from `zero` — price came back $0 AND the item is missing from
      // the selected branch's availability list. Caller must verify branch
      // stocking before treating this as a price at all.
      kind: 'zero_price_needs_availability_check';
      reason?: string;
    }
  | { kind: 'error'; reason: string };

export type AbcLockReason =
  | 'missing_ship_to'
  | 'missing_branch'
  | 'missing_item_number'
  | 'missing_uom';

export const ABC_LOCK_MESSAGES: Record<AbcLockReason, string> = {
  missing_ship_to: 'ABC pricing locked: select Ship-To account.',
  missing_branch: 'ABC pricing locked: select Branch.',
  missing_item_number:
    'ABC pricing locked: item has not been mapped to ABC Product API result.',
  missing_uom: 'ABC pricing locked: valid UOM required from Product API.',
};

/**
 * Evaluate the ABC lock gate in priority order. Returns the first failing
 * reason, or null if all preconditions are satisfied and a real price call
 * may proceed.
 */
export function evaluateAbcLock(input: {
  shipToNumber?: string | null;
  branchNumber?: string | null;
  itemNumber?: string | null;
  uom?: string | null;
}): AbcLockReason | null {
  if (!input.shipToNumber) return 'missing_ship_to';
  if (!input.branchNumber) return 'missing_branch';
  if (!input.itemNumber) return 'missing_item_number';
  if (!input.uom) return 'missing_uom';
  return null;
}

export interface SupplierPriceRowInput {
  unit_price?: number | null;
  uom?: string | null;
  currency?: string | null;
  price_pending?: boolean | null;
  reason?: string | null;
  observed_at?: string | null;
  // legacy ABC fields
  abc_price?: number | null;
  abc_price_status?: 'priced' | 'zero' | 'unavailable' | 'error' | null;
  abc_price_error?: string | null;
  abc_price_timestamp?: string | null;
}

/**
 * Map an edge-function/legacy row into a typed SupplierPriceState.
 * Centralizes the rule that price === 0 is NEVER `priced` — it's `zero`.
 */
export function toSupplierPriceState(
  row: SupplierPriceRowInput | null | undefined,
): SupplierPriceState {
  if (!row) return { kind: 'unmapped' };

  // Legacy ABC shape
  if (row.abc_price_status) {
    switch (row.abc_price_status) {
      case 'priced': {
        const p = Number(row.abc_price ?? 0);
        if (!Number.isFinite(p) || p <= 0) {
          return { kind: 'zero', reason: 'contract_zero' };
        }
        return {
          kind: 'priced',
          unitPrice: p,
          uom: row.uom ?? null,
          currency: row.currency ?? 'USD',
          observedAt: row.abc_price_timestamp ?? new Date().toISOString(),
        };
      }
      case 'zero':
        return { kind: 'zero', reason: 'contract_zero' };
      case 'unavailable':
        return { kind: 'error', reason: row.abc_price_error || 'No price available' };
      case 'error':
        return { kind: 'error', reason: row.abc_price_error || 'Price request failed' };
    }
  }

  if (row.price_pending) {
    return { kind: 'pending', reason: row.reason ?? undefined };
  }

  const p = row.unit_price;
  if (p == null) {
    return { kind: 'error', reason: row.reason || 'No price returned' };
  }
  const n = Number(p);
  if (!Number.isFinite(n)) {
    return { kind: 'error', reason: 'Invalid price' };
  }
  if (n <= 0) {
    return { kind: 'zero', reason: 'contract_zero' };
  }
  return {
    kind: 'priced',
    unitPrice: n,
    uom: row.uom ?? null,
    currency: row.currency ?? 'USD',
    observedAt: row.observed_at ?? new Date().toISOString(),
  };
}

/** Short label suitable for a badge/cell. */
export function describeSupplierPriceState(state: SupplierPriceState): string {
  switch (state.kind) {
    case 'unmapped':
      return 'Not mapped';
    case 'pending':
      return 'Pending';
    case 'priced':
      return `$${state.unitPrice.toFixed(2)}`;
    case 'zero':
      return state.reason === 'no_contract'
        ? 'No contract price'
        : 'Zero on contract — verify';
    case 'error':
      return state.reason || 'Error';
  }
}
