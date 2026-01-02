import { useMemo } from 'react';

export interface FinancingOption {
  termMonths: number;
  apr: number;
  monthlyPayment: number;
  totalCost: number;
  totalInterest: number;
}

export interface UseFinancingCalculationsProps {
  principal: number;
  defaultApr?: number;
  terms?: number[];
}

/**
 * Calculate monthly payment using standard amortization formula
 * M = P * (r(1+r)^n) / ((1+r)^n - 1)
 */
function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRate === 0) return principal / termMonths;
  
  const monthlyRate = annualRate / 100 / 12;
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return principal * (monthlyRate * factor) / (factor - 1);
}

export function useFinancingCalculations({
  principal,
  defaultApr = 8.99,
  terms = [36, 60, 84, 120]
}: UseFinancingCalculationsProps) {
  const options = useMemo<FinancingOption[]>(() => {
    if (principal <= 0) return [];
    
    return terms.map(termMonths => {
      const monthlyPayment = calculateMonthlyPayment(principal, defaultApr, termMonths);
      const totalCost = monthlyPayment * termMonths;
      const totalInterest = totalCost - principal;
      
      return {
        termMonths,
        apr: defaultApr,
        monthlyPayment: Math.round(monthlyPayment * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        totalInterest: Math.round(totalInterest * 100) / 100
      };
    });
  }, [principal, defaultApr, terms]);

  const lowestMonthlyPayment = useMemo(() => {
    if (options.length === 0) return null;
    return options.reduce((min, opt) => 
      opt.monthlyPayment < min.monthlyPayment ? opt : min
    );
  }, [options]);

  return {
    options,
    lowestMonthlyPayment,
    apr: defaultApr
  };
}
