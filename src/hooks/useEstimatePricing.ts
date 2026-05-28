// Pricing calculations hook with fixed price override support
// Supports both profit_split (commission from net profit) and sales_percentage (commission from sale)
import { useState, useCallback, useMemo, useEffect } from 'react';

export interface LineItem {
  id: string;
  item_name: string;
  description?: string;           // Product description for consumer-facing PDFs
  notes?: string;                 // Color/specs for supplier orders
  item_type: 'material' | 'labor' | 'change_order';
  labor_phase?: 'tear_off' | 'install'; // For labor items: tear_off runs before materials, install after
  qty: number;
  qty_original?: number;
  unit: string;
  unit_cost: number;
  unit_cost_original?: number;
  line_total: number;
  is_override?: boolean;
  sort_order?: number;
  trade_type?: string;            // e.g. 'roofing', 'gutters', 'siding'
  trade_label?: string;           // e.g. 'Roofing', 'Gutters'
  /**
   * When true, this line item is treated as a pass-through cost:
   * - excluded from the overhead (OH%) base
   * - excluded from the profit-margin base (no profit applied)
   * - added to the selling price at raw cost
   * Used for client-supplied / reimbursable items.
   */
  exclude_from_overhead?: boolean;
}


export interface PricingConfig {
  overheadPercent: number;
  profitMarginPercent: number;
  repCommissionPercent: number;
  commissionStructure: 'profit_split' | 'sales_percentage';
  // Sales tax settings (from company config, read-only in estimates)
  salesTaxEnabled: boolean;
  salesTaxRate: number;
}

export interface PricingBreakdown {
  materialsTotal: number;
  laborTotal: number;
  directCost: number;
  overheadAmount: number;
  totalCost: number;
  profitAmount: number;
  netProfit: number; // Net profit before commission (for profit_split display)
  repCommissionAmount: number;
  sellingPrice: number; // NOW INCLUDES TAX (customer-facing total)
  preTaxSellingPrice: number; // Internal: selling price before tax
  actualProfitMargin: number;
  // Sales tax (applied to materials portion only - labor is tax-exempt)
  materialsSellingPortion: number; // Materials portion of selling price for tax calculation
  salesTaxAmount: number; // Internal tracking only - baked into sellingPrice
  totalWithTax: number; // Same as sellingPrice (backward compatibility)
}

export interface UseEstimatePricingReturn {
  lineItems: LineItem[];
  materialItems: LineItem[];
  laborItems: LineItem[];
  changeOrderItems: LineItem[];
  breakdown: PricingBreakdown;
  config: PricingConfig;
  isFixedPrice: boolean;
  fixedPrice: number | null;
  setLineItems: (items: LineItem[]) => void;
  updateLineItem: (id: string, updates: Partial<LineItem>) => void;
  setConfig: (config: Partial<PricingConfig>) => void;
  setFixedPrice: (price: number | null) => void;
  resetToOriginal: () => void;
  getProfitMarginColor: (margin: number) => string;
}

const DEFAULT_CONFIG: PricingConfig = {
  overheadPercent: 10,
  profitMarginPercent: 30,
  repCommissionPercent: 8,
  commissionStructure: 'profit_split',
  salesTaxEnabled: false,
  salesTaxRate: 0,
};

export function useEstimatePricing(
  initialItems: LineItem[] = [],
  initialConfig?: Partial<PricingConfig>
): UseEstimatePricingReturn {
  const [lineItems, setLineItems] = useState<LineItem[]>(initialItems);
  const [config, setConfigState] = useState<PricingConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...initialConfig,
  }));
  const [fixedPrice, setFixedPriceState] = useState<number | null>(null);

  // Update config when initialConfig changes (e.g., when rep rates or tax settings are fetched)
  useEffect(() => {
    if (initialConfig) {
      setConfigState(current => ({
        ...current,
        overheadPercent: initialConfig.overheadPercent ?? current.overheadPercent,
        repCommissionPercent: initialConfig.repCommissionPercent ?? current.repCommissionPercent,
        commissionStructure: initialConfig.commissionStructure ?? current.commissionStructure,
        salesTaxEnabled: initialConfig.salesTaxEnabled ?? current.salesTaxEnabled,
        salesTaxRate: initialConfig.salesTaxRate ?? current.salesTaxRate,
      }));
    }
  }, [initialConfig?.overheadPercent, initialConfig?.repCommissionPercent, initialConfig?.commissionStructure, initialConfig?.salesTaxEnabled, initialConfig?.salesTaxRate]);

  const isFixedPrice = fixedPrice !== null;

  // Separate items by type
  const materialItems = useMemo(() => 
    lineItems
      .filter(item => item.item_type === 'material')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [lineItems]
  );

  const laborItems = useMemo(() => 
    lineItems
      .filter(item => item.item_type === 'labor')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [lineItems]
  );

  // Change order items are excluded from all cost/pricing calculations
  const changeOrderItems = useMemo(() => 
    lineItems
      .filter(item => item.item_type === 'change_order')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
  const breakdown = useMemo((): PricingBreakdown => {
    const materialsTotal = materialItems.reduce((sum, item) => sum + item.line_total, 0);
    const laborTotal = laborItems.reduce((sum, item) => sum + item.line_total, 0);
    const directCost = materialsTotal + laborTotal;

    // Items flagged as exclude_from_overhead are pass-through:
    // no overhead, no profit — added to selling price at cost.
    const passThroughTotal = [...materialItems, ...laborItems]
      .filter(i => i.exclude_from_overhead)
      .reduce((sum, item) => sum + item.line_total, 0);
    const coreDirectCost = Math.max(0, directCost - passThroughTotal);

    let sellingPrice: number;
    let overheadAmount: number;
    let profitAmount: number;
    let actualProfitMargin: number;

    if (isFixedPrice) {
      // Fixed price mode: user-entered price IS the final tax-included price
      // Back-calculate the pre-tax selling price to make everything fit
      
      // Calculate materials ratio first (for tax calculation)
      const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
      
      // Derive pre-tax selling price from fixed price
      const taxMultiplier = config.salesTaxEnabled 
        ? 1 + (materialsRatio * (config.salesTaxRate / 100))
        : 1;
      
      sellingPrice = fixedPrice! / taxMultiplier;  // Pre-tax selling price
      // Overhead/profit apply only to the core (non-pass-through) portion
      const coreSelling = Math.max(0, sellingPrice - passThroughTotal);
      overheadAmount = coreSelling * (config.overheadPercent / 100);
      profitAmount = coreSelling - coreDirectCost - overheadAmount;
      actualProfitMargin = sellingPrice > 0 ? (profitAmount / sellingPrice) * 100 : 0;
    } else {
      // Standard mode: solve for selling price algebraically using the CORE direct cost
      // Pass-through items are tacked onto the final price at raw cost.
      const overheadDecimal = config.overheadPercent / 100;
      const profitDecimal = config.profitMarginPercent / 100;
      const materialsRatioForTax = directCost > 0 ? materialsTotal / directCost : 0;
      const taxFactor = config.salesTaxEnabled ? materialsRatioForTax * (config.salesTaxRate / 100) : 0;

      // Core selling price (covers overhead + profit on coreDirectCost)
      const divisor = 1 - overheadDecimal * (1 + taxFactor) - profitDecimal;

      let coreSelling: number;
      if (divisor <= 0) {
        coreSelling = coreDirectCost * 3; // Fallback
      } else {
        coreSelling = coreDirectCost / divisor;
      }

      profitAmount = coreSelling * profitDecimal;
      const taxAmountForOverhead = coreSelling * taxFactor;
      overheadAmount = (coreSelling + taxAmountForOverhead) * overheadDecimal;
      sellingPrice = coreSelling + passThroughTotal;
      actualProfitMargin = config.profitMarginPercent;
    }

    
    // Store pre-tax selling price for internal accounting
    const preTaxSellingPrice = sellingPrice;
    
    // BAKE TAX INTO SELLING PRICE - customer sees one total with tax included
    const finalSellingPrice = sellingPrice + salesTaxAmount;
    
    // totalWithTax = same as finalSellingPrice for backward compatibility
    const totalWithTax = finalSellingPrice;

    return {
      materialsTotal,
      laborTotal,
      directCost,
      overheadAmount,
      totalCost,
      profitAmount,
      netProfit,
      repCommissionAmount,
      sellingPrice: finalSellingPrice, // NOW INCLUDES TAX
      preTaxSellingPrice, // Internal: before tax
      actualProfitMargin,
      materialsSellingPortion,
      salesTaxAmount, // Still tracked for internal accounting
      totalWithTax, // Same as sellingPrice (backward compat)
    };
  }, [materialItems, laborItems, config, isFixedPrice, fixedPrice]);

  // Update a single line item
  const updateLineItem = useCallback((id: string, updates: Partial<LineItem>) => {
    setLineItems(current => 
      current.map(item => {
        if (item.id !== id) return item;
        
        const updated = { ...item, ...updates, is_override: true };
        
        // Recalculate line total if qty or unit_cost changed
        if ('qty' in updates || 'unit_cost' in updates) {
          updated.line_total = updated.qty * updated.unit_cost;
        }
        
        return updated;
      })
    );
  }, []);

  // Set config with partial updates
  const setConfig = useCallback((updates: Partial<PricingConfig>) => {
    setConfigState(current => ({ ...current, ...updates }));
  }, []);

  // Set fixed price
  const setFixedPrice = useCallback((price: number | null) => {
    setFixedPriceState(price);
  }, []);

  // Reset all items to original values
  const resetToOriginal = useCallback(() => {
    setLineItems(current => 
      current.map(item => ({
        ...item,
        qty: item.qty_original ?? item.qty,
        unit_cost: item.unit_cost_original ?? item.unit_cost,
        line_total: (item.qty_original ?? item.qty) * (item.unit_cost_original ?? item.unit_cost),
        is_override: false,
      }))
    );
    setFixedPriceState(null);
  }, []);

  // Get color based on profit margin
  const getProfitMarginColor = useCallback((margin: number): string => {
    if (margin >= 30) return 'text-green-600';
    if (margin >= 20) return 'text-yellow-600';
    if (margin >= 15) return 'text-orange-500';
    return 'text-red-600';
  }, []);

  return {
    lineItems,
    materialItems,
    laborItems,
    changeOrderItems,
    breakdown,
    config,
    isFixedPrice,
    fixedPrice,
    setLineItems,
    updateLineItem,
    setConfig,
    setFixedPrice,
    resetToOriginal,
    getProfitMarginColor,
  };
}
