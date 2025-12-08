/**
 * Centralized Commission Calculator
 * 
 * Handles both commission types:
 * - Selling Price Plan: Commission = Contract Value × Rate %
 * - Profit Split Plan: Commission = (Gross Profit - Rep Overhead) × Rate %
 */

export interface CommissionInput {
  contractValue: number;
  actualMaterialCost: number;
  actualLaborCost: number;
  adjustments: number; // Positive for credits, negative for chargebacks
  repOverheadRate: number; // Percentage (e.g., 5 for 5%)
  commissionType: 'percentage_selling_price' | 'profit_split';
  commissionRate: number; // Percentage (e.g., 10 for 10%)
}

export interface CommissionResult {
  contractValue: number;
  materialCost: number;
  laborCost: number;
  totalJobCost: number;
  adjustments: number;
  grossProfit: number;
  repOverheadAmount: number;
  netProfit: number;
  commissionAmount: number;
  commissionType: string;
  commissionRate: number;
}

export function calculateCommission(input: CommissionInput): CommissionResult {
  const {
    contractValue,
    actualMaterialCost,
    actualLaborCost,
    adjustments,
    repOverheadRate,
    commissionType,
    commissionRate
  } = input;

  // Calculate total job costs
  const totalJobCost = actualMaterialCost + actualLaborCost;

  // Calculate gross profit (before rep overhead)
  // Adjustments: positive = credits (increase profit), negative = chargebacks (decrease profit)
  const grossProfit = contractValue - totalJobCost + adjustments;

  // Calculate rep overhead (percentage of contract value)
  const repOverheadAmount = contractValue * (repOverheadRate / 100);

  // Calculate net profit available for splitting
  const netProfit = grossProfit - repOverheadAmount;

  // Calculate commission based on type
  let commissionAmount = 0;

  if (commissionType === 'percentage_selling_price') {
    // Selling Price Plan: commission on total contract value
    commissionAmount = contractValue * (commissionRate / 100);
  } else {
    // Profit Split Plan: commission on net profit (after rep overhead)
    commissionAmount = Math.max(0, netProfit * (commissionRate / 100));
  }

  return {
    contractValue,
    materialCost: actualMaterialCost,
    laborCost: actualLaborCost,
    totalJobCost,
    adjustments,
    grossProfit,
    repOverheadAmount,
    netProfit,
    commissionAmount: Math.round(commissionAmount * 100) / 100,
    commissionType,
    commissionRate
  };
}

/**
 * Calculate estimated costs based on industry standard percentages
 * Materials: ~32.5% of contract, Labor: ~32.5% of contract
 */
export function estimateCostsFromContract(contractValue: number): {
  estimatedMaterialCost: number;
  estimatedLaborCost: number;
  estimatedGrossProfit: number;
} {
  const materialRate = 0.325;
  const laborRate = 0.325;

  const estimatedMaterialCost = contractValue * materialRate;
  const estimatedLaborCost = contractValue * laborRate;
  const estimatedGrossProfit = contractValue - estimatedMaterialCost - estimatedLaborCost;

  return {
    estimatedMaterialCost: Math.round(estimatedMaterialCost * 100) / 100,
    estimatedLaborCost: Math.round(estimatedLaborCost * 100) / 100,
    estimatedGrossProfit: Math.round(estimatedGrossProfit * 100) / 100
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(amount);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
