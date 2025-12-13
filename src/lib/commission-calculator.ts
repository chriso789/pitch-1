/**
 * Centralized Commission Calculator
 * 
 * Handles both commission types:
 * - Percent of Contract Price: Commission = Contract Value × Rate %
 * - Profit Split: Commission = (Gross Profit - Rep Overhead) × Rate %
 * 
 * Also handles Manager Override calculations:
 * - Manager Override = Contract Value × Manager Override Rate %
 */

export interface CommissionInput {
  contractValue: number;
  actualMaterialCost: number;
  actualLaborCost: number;
  adjustments: number; // Positive for credits, negative for chargebacks
  repOverheadRate: number; // Percentage (e.g., 5 for 5%)
  commissionType: 'percentage_contract_price' | 'profit_split';
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
  commissionBase: number; // The base amount used for commission calculation
}

export interface ManagerOverrideInput {
  contractValue: number;
  managerOverrideRate: number; // Percentage (e.g., 3 for 3%)
}

export interface ManagerOverrideResult {
  contractValue: number;
  overrideRate: number;
  overrideAmount: number;
}

/**
 * Calculate commission based on type
 * - Percent of Contract Price: Commission = Contract Value × Rate %
 * - Profit Split: Commission = Net Profit × Rate %
 */
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
  let commissionAmount: number;
  let commissionBase: number;

  if (commissionType === 'percentage_contract_price') {
    // Percent of Contract Price: Commission = Contract Value × Rate %
    commissionBase = contractValue;
    commissionAmount = contractValue * (commissionRate / 100);
  } else {
    // Profit Split: Commission = Net Profit × Rate %
    commissionBase = netProfit;
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
    commissionRate,
    commissionBase
  };
}

/**
 * Calculate manager override amount
 * Manager Override = Contract Value × Manager Override Rate %
 */
export function calculateManagerOverride(input: ManagerOverrideInput): ManagerOverrideResult {
  const { contractValue, managerOverrideRate } = input;
  
  const overrideAmount = contractValue * (managerOverrideRate / 100);

  return {
    contractValue,
    overrideRate: managerOverrideRate,
    overrideAmount: Math.round(overrideAmount * 100) / 100
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
