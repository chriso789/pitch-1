// Pricing calculations hook with fixed price override support
// Supports both profit_split (commission from net profit) and sales_percentage (commission from sale)
import { useState, useCallback, useMemo, useEffect } from 'react';

export interface LineItem {
  id: string;
  item_name: string;
  description?: string;           // Product description for consumer-facing PDFs
  notes?: string;                 // Color/specs for supplier orders
  item_type: 'material' | 'labor' | 'turnkey' | 'change_order';
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
  materialsTotal: number;        // Raw materials cost (pre-tax)
  laborTotal: number;
  salesTaxAmount: number;        // Sales tax on materials COST — treated as direct cost line
  directCost: number;            // materials + labor + sales tax
  overheadAmount: number;        // Overhead applied as a percentage of selling price
  totalCost: number;             // directCost + overhead
  profitAmount: number;
  netProfit: number;
  repCommissionAmount: number;
  sellingPrice: number;          // Final customer price
  preTaxSellingPrice: number;    // = sellingPrice (tax is a cost component now)
  actualProfitMargin: number;
  materialsSellingPortion: number;
  totalWithTax: number;          // Backward compat = sellingPrice
}

export interface UseEstimatePricingReturn {
  lineItems: LineItem[];
  materialItems: LineItem[];
  laborItems: LineItem[];
  turnkeyItems: LineItem[];
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

  // Turnkey items: subcontracted/bundled scopes — priced like labor (no sales tax)
  const turnkeyItems = useMemo(() =>
    lineItems
      .filter(item => item.item_type === 'turnkey')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [lineItems]
  );

  // Change order items are excluded from all cost/pricing calculations
  const changeOrderItems = useMemo(() =>
    lineItems
      .filter(item => item.item_type === 'change_order')
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [lineItems]
  );

  // Calculate pricing breakdown
  //
  // NEW MODEL: Sales tax on materials is a DIRECT COST line item.
  //   directCost = materials + labor + salesTax
  //   overhead   = sellingPrice × overhead%   (OH is % of selling price, not cost)
  //   profit     = sellingPrice × profit%
  //   selling    = directCost / (1 - overhead% - profit%)
  const breakdown = useMemo((): PricingBreakdown => {
    const materialsTotal = materialItems.reduce((sum, item) => sum + item.line_total, 0);
    const laborTotal =
      laborItems.reduce((sum, item) => sum + item.line_total, 0) +
      turnkeyItems.reduce((sum, item) => sum + item.line_total, 0);

    // Pass-through items: cost only, no overhead/profit/tax
    const passThroughTotal = [...materialItems, ...laborItems, ...turnkeyItems]
      .filter(i => i.exclude_from_overhead)
      .reduce((sum, item) => sum + item.line_total, 0);

    // Sales tax applies to taxable materials cost only (exclude pass-through materials)
    const taxableMaterialsCost = materialItems
      .filter(i => !i.exclude_from_overhead)
      .reduce((sum, item) => sum + item.line_total, 0);
    const salesTaxAmount = config.salesTaxEnabled
      ? taxableMaterialsCost * (config.salesTaxRate / 100)
      : 0;

    const directCost = materialsTotal + laborTotal + salesTaxAmount;

    // Core cost base for overhead/profit (excludes pass-through, includes tax)
    const coreDirectCost = Math.max(
      0,
      (materialsTotal + laborTotal - passThroughTotal) + salesTaxAmount
    );

    let sellingPrice: number;
    let overheadAmount: number;
    let profitAmount: number;
    let actualProfitMargin: number;

    const overheadDecimal = config.overheadPercent / 100;

    if (isFixedPrice) {
      // Fixed price mode: user-entered price IS the final price.
      // Overhead = sellingPrice × OH%, profit is the residual.
      sellingPrice = fixedPrice!;
      const coreSelling = Math.max(0, sellingPrice - passThroughTotal);
      overheadAmount = coreSelling * overheadDecimal;
      profitAmount = coreSelling - coreDirectCost - overheadAmount;
      actualProfitMargin = sellingPrice > 0 ? (profitAmount / sellingPrice) * 100 : 0;
    } else {
      // Standard mode: solve for selling price so OH% and profit% are both
      // percentages of the sale price, never percentages of direct cost.
      //   directCost = sellingPrice - (sellingPrice × OH%) - (sellingPrice × profit%)
      //   coreSelling = coreDirectCost / (1 - OH% - profit%)
      const profitDecimal = config.profitMarginPercent / 100;
      const denom = Math.max(0.01, 1 - overheadDecimal - profitDecimal);
      const coreSelling = coreDirectCost / denom;

      overheadAmount = coreSelling * overheadDecimal;
      profitAmount = coreSelling * profitDecimal;
      sellingPrice = coreSelling + passThroughTotal;
      actualProfitMargin = config.profitMarginPercent;
    }

    const totalCost = directCost + overheadAmount;
    const netProfit = sellingPrice - directCost - overheadAmount;

    let repCommissionAmount: number;
    if (config.commissionStructure === 'profit_split') {
      repCommissionAmount = Math.max(0, netProfit * (config.repCommissionPercent / 100));
    } else {
      repCommissionAmount = sellingPrice * (config.repCommissionPercent / 100);
    }

    const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
    const materialsSellingPortion = sellingPrice * materialsRatio;

    return {
      materialsTotal,
      laborTotal,
      salesTaxAmount,
      directCost,
      overheadAmount,
      totalCost,
      profitAmount,
      netProfit,
      repCommissionAmount,
      sellingPrice,
      preTaxSellingPrice: sellingPrice,
      actualProfitMargin,
      materialsSellingPortion,
      totalWithTax: sellingPrice,
    };
  }, [materialItems, laborItems, turnkeyItems, config, isFixedPrice, fixedPrice]);


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
    turnkeyItems,
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
