import { expect, it } from 'vitest';
import { calculateJobFinancials } from '../src/features/jobs/financialSummary';
it('financials reflect recorded costs, payments and approved commissions, never pending commission', () => {
  expect(calculateJobFinancials({ contractValue: 20000, costs: [{total_cost:12000}], payments: [{amount:8000}],
    commissions: [{commission_amount:2000,status:'approved'},{commission_amount:5000,status:'pending'}] }))
    .toEqual({totalBudget:20000,actualCosts:12000,totalPaid:8000,remainingBalance:12000,salesRepCommission:2000,profitMargin:30});
});
it('refunds reduce collections and decimal amounts sum without currency drift', () => {
  const result = calculateJobFinancials({contractValue: 1, costs: [],payments:[{amount:0.1},{amount:0.2},{amount:-0.1}],commissions:[]});
  expect(result.totalPaid).toBe(0.2); expect(result.remainingBalance).toBe(0.8);
});
it('invalid or missing monetary evidence blocks a summary rather than inventing a value', () => {
  expect(() => calculateJobFinancials({contractValue:NaN,costs:[],payments:[],commissions:[]})).toThrow(/invalid amount/);
});
