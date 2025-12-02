// Pricing calculation hook for Smart Template Editor

export interface PricingResult {
  price: number;
  profitAmount: number;
  profitPercent: number;
}

export const usePricingCalculation = () => {
  // Calculate price from cost using profit margin
  // Formula: Price = Cost / (1 - Margin%)
  // e.g., $43.00 / (1 - 0.30) = $43.00 / 0.70 = $61.43
  const calculatePrice = (
    cost: number,
    profitMargin: number,
    pricingType: 'profit_margin' | 'fixed',
    fixedPrice?: number
  ): PricingResult => {
    if (pricingType === 'fixed' && fixedPrice !== undefined) {
      const profitAmount = fixedPrice - cost;
      const profitPercent = cost > 0 ? (profitAmount / fixedPrice) * 100 : 0;
      return { price: fixedPrice, profitAmount, profitPercent };
    }

    const marginDecimal = profitMargin / 100;
    const price = marginDecimal < 1 ? cost / (1 - marginDecimal) : cost * 2;
    const profitAmount = price - cost;

    return { price, profitAmount, profitPercent: profitMargin };
  };

  // Calculate cost from price using profit margin (reverse calculation)
  const calculateCostFromPrice = (price: number, profitMargin: number): number => {
    const marginDecimal = profitMargin / 100;
    return price * (1 - marginDecimal);
  };

  // Calculate quantity based on measurement type and roof data
  const calculateQuantity = (
    measurementType: string | null,
    roofData: {
      totalSquares?: number;
      ridgesLF?: number;
      hipsLF?: number;
      valleysLF?: number;
      rakesLF?: number;
      eavesLF?: number;
    },
    coverage?: number // e.g., 2 for "covers 2 SQ"
  ): number => {
    if (!measurementType) return 1;

    const coverageFactor = coverage || 1;
    
    switch (measurementType) {
      case 'roof_area':
        return Math.ceil((roofData.totalSquares || 0) / coverageFactor);
      case 'ridges':
        return Math.ceil((roofData.ridgesLF || 0) / coverageFactor);
      case 'hips':
        return Math.ceil((roofData.hipsLF || 0) / coverageFactor);
      case 'valleys':
        return Math.ceil((roofData.valleysLF || 0) / coverageFactor);
      case 'rakes':
        return Math.ceil((roofData.rakesLF || 0) / coverageFactor);
      case 'eaves':
        return Math.ceil((roofData.eavesLF || 0) / coverageFactor);
      default:
        return 1;
    }
  };

  // Format currency
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  return {
    calculatePrice,
    calculateCostFromPrice,
    calculateQuantity,
    formatCurrency,
  };
};
