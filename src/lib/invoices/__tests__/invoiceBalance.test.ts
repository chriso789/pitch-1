import { describe, it, expect } from 'vitest';
import {
  computeRemainingInvoiceBalance,
  scaleGroupsToInvoiceBalance,
  selectedGroupsTotal,
  sumOutstandingInvoices,
  sumRecordedPayments,
  validateInvoiceAgainstRemaining,
  type InvoiceGroupLike,
} from '../invoiceBalance';

const makeGroup = (
  key: string,
  lineTotals: number[],
  overrides: Partial<InvoiceGroupLike> = {},
): InvoiceGroupLike => ({
  key,
  kind: 'trade',
  label: key,
  selected: true,
  children: lineTotals.map((line_total, i) => ({
    description: `${key} item ${i}`,
    qty: 1,
    unit: 'ea',
    unit_cost: line_total,
    line_total,
    selected: true,
  })),
  ...overrides,
});

describe('sumRecordedPayments', () => {
  it('returns 0 for null/empty', () => {
    expect(sumRecordedPayments(null)).toBe(0);
    expect(sumRecordedPayments([])).toBe(0);
  });

  it('sums payment amounts net of cc_fee_amount', () => {
    expect(
      sumRecordedPayments([
        { amount: 1000 },
        { amount: 500, cc_fee_amount: 50 },
        { amount: 250, cc_fee_amount: 0 },
      ]),
    ).toBe(1000 + 450 + 250);
  });

  it('never returns a negative per-payment contribution', () => {
    expect(
      sumRecordedPayments([{ amount: 100, cc_fee_amount: 250 }]),
    ).toBe(0);
  });
});

describe('sumOutstandingInvoices', () => {
  it('skips void invoices and prefers balance over amount', () => {
    expect(
      sumOutstandingInvoices([
        { status: 'sent', balance: 500, amount: 800 },
        { status: 'void', balance: 999 },
        { status: 'partial', amount: 200 }, // no balance → falls back to amount
      ]),
    ).toBe(500 + 200);
  });
});

describe('computeRemainingInvoiceBalance', () => {
  it('returns the full contract when nothing has been paid or invoiced', () => {
    expect(
      computeRemainingInvoiceBalance({ sellingPrice: 10_000, payments: [], outstandingInvoices: [] }),
    ).toBe(10_000);
  });

  it('subtracts recorded payments (net of CC fees) on a partially paid contract', () => {
    expect(
      computeRemainingInvoiceBalance({
        sellingPrice: 10_000,
        payments: [
          { amount: 3000 },
          { amount: 2000, cc_fee_amount: 70 },
        ],
        outstandingInvoices: [],
      }),
    ).toBe(10_000 - 3000 - 1930);
  });

  it('returns 0 when the contract is fully paid (total === balance due)', () => {
    expect(
      computeRemainingInvoiceBalance({
        sellingPrice: 8_500,
        payments: [{ amount: 5_000 }, { amount: 3_500 }],
        outstandingInvoices: [],
      }),
    ).toBe(0);
  });

  it('clamps to 0 if payments exceed the contract value', () => {
    expect(
      computeRemainingInvoiceBalance({
        sellingPrice: 5_000,
        payments: [{ amount: 6_000 }],
        outstandingInvoices: [],
      }),
    ).toBe(0);
  });

  it('also subtracts outstanding non-void invoice balances', () => {
    expect(
      computeRemainingInvoiceBalance({
        sellingPrice: 12_000,
        payments: [{ amount: 2_000 }],
        outstandingInvoices: [
          { status: 'sent', balance: 3_000 },
          { status: 'void', balance: 1_000 },
        ],
      }),
    ).toBe(12_000 - 2_000 - 3_000);
  });
});

describe('scaleGroupsToInvoiceBalance', () => {
  it('returns groups unchanged when target >= current total', () => {
    const groups = [makeGroup('roofing', [4_000, 6_000])];
    const result = scaleGroupsToInvoiceBalance(groups, 10_000);
    expect(selectedGroupsTotal(result)).toBe(10_000);
  });

  it('zeroes every selected child when target is 0 (fully paid contract)', () => {
    const groups = [makeGroup('roofing', [4_000, 6_000])];
    const result = scaleGroupsToInvoiceBalance(groups, 0);
    expect(selectedGroupsTotal(result)).toBe(0);
    for (const child of result[0].children) {
      expect(child.line_total).toBe(0);
      expect(child.unit_cost).toBe(0);
    }
  });

  it('scales groups proportionally to a partial remaining balance', () => {
    const groups = [
      makeGroup('roofing', [4_000, 6_000]),
      makeGroup('co:1', [2_000], { kind: 'change_order' }),
    ];
    // Contract = 12k, paid 9k → remaining 3k. 25% of original.
    const result = scaleGroupsToInvoiceBalance(groups, 3_000);
    expect(selectedGroupsTotal(result)).toBeCloseTo(3_000, 2);
    // Each group should still exist and keep its structure.
    expect(result).toHaveLength(2);
    expect(result[0].children).toHaveLength(2);
    expect(result[1].children).toHaveLength(1);
  });

  it('applies a final penny adjustment so the scaled total matches exactly', () => {
    const groups = [makeGroup('roofing', [333.33, 333.33, 333.34])];
    const result = scaleGroupsToInvoiceBalance(groups, 777.77);
    expect(selectedGroupsTotal(result)).toBe(777.77);
  });

  it('leaves unselected children untouched', () => {
    const groups = [
      {
        key: 'mixed',
        kind: 'trade' as const,
        label: 'Mixed',
        selected: true,
        children: [
          { description: 'A', qty: 1, unit: 'ea', unit_cost: 1000, line_total: 1000, selected: true },
          { description: 'B', qty: 1, unit: 'ea', unit_cost: 500, line_total: 500, selected: false },
        ],
      },
    ];
    const result = scaleGroupsToInvoiceBalance(groups, 500);
    expect(result[0].children[1].line_total).toBe(500); // unchanged
    expect(result[0].children[0].line_total).toBe(500); // scaled to target
    expect(selectedGroupsTotal(result)).toBe(500);
  });
});

describe('Create Invoice default — end-to-end balance behavior', () => {
  const baseGroups = (): InvoiceGroupLike[] => [
    makeGroup('roofing', [6_000, 4_000]),
    makeGroup('co:1', [2_000], { kind: 'change_order' }),
  ];

  it('fully paid contract → invoice defaults to $0', () => {
    const remaining = computeRemainingInvoiceBalance({
      sellingPrice: 12_000,
      payments: [{ amount: 6_000 }, { amount: 6_000 }],
      outstandingInvoices: [],
    });
    expect(remaining).toBe(0);
    const scaled = scaleGroupsToInvoiceBalance(baseGroups(), remaining);
    expect(selectedGroupsTotal(scaled)).toBe(0);
  });

  it('partially paid contract → invoice defaults to (total − recorded payments)', () => {
    const remaining = computeRemainingInvoiceBalance({
      sellingPrice: 12_000,
      payments: [{ amount: 5_000, cc_fee_amount: 100 }], // 4900 net
      outstandingInvoices: [],
    });
    expect(remaining).toBe(12_000 - 4_900);
    const scaled = scaleGroupsToInvoiceBalance(baseGroups(), remaining);
    expect(selectedGroupsTotal(scaled)).toBeCloseTo(remaining, 2);
  });

  it('unpaid contract → invoice defaults to the full contract amount', () => {
    const remaining = computeRemainingInvoiceBalance({
      sellingPrice: 12_000,
      payments: [],
      outstandingInvoices: [],
    });
    expect(remaining).toBe(12_000);
    const scaled = scaleGroupsToInvoiceBalance(baseGroups(), remaining);
    expect(selectedGroupsTotal(scaled)).toBe(12_000);
  });
});

describe('validateInvoiceAgainstRemaining', () => {
  it('passes when proposed total equals remaining', () => {
    expect(
      validateInvoiceAgainstRemaining({ proposedTotal: 3_000, remainingBalance: 3_000, overrideRemaining: false }),
    ).toEqual({ ok: true });
  });

  it('passes when proposed total is below remaining', () => {
    expect(
      validateInvoiceAgainstRemaining({ proposedTotal: 2_500, remainingBalance: 3_000, overrideRemaining: false }),
    ).toEqual({ ok: true });
  });

  it('blocks when proposed total exceeds remaining and override is OFF', () => {
    const result = validateInvoiceAgainstRemaining({
      proposedTotal: 4_500,
      remainingBalance: 3_000,
      overrideRemaining: false,
    });
    if (result.ok) {
      throw new Error('expected validation to fail');
    }
    expect(result.reason).toBe('exceeds_remaining');
    expect(result.overBy).toBe(1_500);
  });

  it('allows over-billing when override is explicitly ON', () => {
    expect(
      validateInvoiceAgainstRemaining({
        proposedTotal: 4_500,
        remainingBalance: 3_000,
        overrideRemaining: true,
      }),
    ).toEqual({ ok: true });
  });

  it('treats sub-penny overage as not exceeding', () => {
    expect(
      validateInvoiceAgainstRemaining({
        proposedTotal: 3_000.005,
        remainingBalance: 3_000,
        overrideRemaining: false,
      }),
    ).toEqual({ ok: true });
  });
});
