// Typed discriminated union for supplier price state.
// Every supplier-pricing UI must consume `SupplierPriceState` rather than
// raw `unit_price: number | null`. This prevents the long-standing bug where
// a contract-zero or "no contract" response was silently rendered as $0.00.

export type SupplierKind = 'abc' | 'srs' | 'qxo';

export type SupplierPriceState =
  | { kind: 'unmapped' }
  | { kind: 'pending'; reason?: string }
  | {
      kind: 'priced';
      unitPrice: number;
      uom: string | null;
      currency: string;
      observedAt: string;
    }
  | { kind: 'zero'; reason: 'contract_zero' | 'no_contract' | 'unknown' }
  | { kind: 'error'; reason: string };

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
