export interface FinancialSummary {
  totalBudget: number;
  actualCosts: number;
  totalPaid: number;
  remainingBalance: number;
  profitMargin: number;
  salesRepCommission: number;
}

/** Money is aggregated in integer cents; missing/invalid source data is not $0. */
export function calculateJobFinancials(input: {
  contractValue: number;
  costs: Array<{ total_cost: number }>;
  payments: Array<{ amount: number }>;
  commissions: Array<{ commission_amount: number; status: string | null }>;
}): FinancialSummary {
  const cents = (value: number) => {
    if (value == null || !Number.isFinite(Number(value))) throw new Error('Financial source contains an invalid amount');
    const amount = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(amount)) throw new Error('Financial amount is too large');
    return amount;
  };
  const contract = cents(input.contractValue);
  const costs = input.costs.reduce((sum, row) => sum + cents(row.total_cost), 0);
  const paid = input.payments.reduce((sum, row) => sum + cents(row.amount), 0);
  const commission = input.commissions.filter(row => row.status === 'approved' || row.status === 'paid')
    .reduce((sum, row) => sum + cents(row.commission_amount), 0);
  return { totalBudget: contract / 100, actualCosts: costs / 100, totalPaid: paid / 100,
    remainingBalance: (contract - paid) / 100, salesRepCommission: commission / 100,
    profitMargin: contract ? Math.round((contract - costs - commission) / contract * 10000) / 100 : 0 };
}
