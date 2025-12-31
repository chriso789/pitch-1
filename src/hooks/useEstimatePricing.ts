// Pricing calculations hook with fixed price override support
import { useState, useCallback, useMemo } from 'react';

export interface LineItem {
  id: string;
  item_name: string;
  item_type: 'material' | 'labor';
  qty: number;
  qty_original?: number;
  unit: string;
  unit_cost: number;
  unit_cost_original?: number;
  line_total: number;
  is_override?: boolean;
  sort_order?: number;
}

export interface PricingConfig {
  overheadPercent: number;
  profitMarginPercent: number;
  repCommissionPercent: number;
}

export interface PricingBreakdown {
  materialsTotal: number;
  laborTotal: number;
  directCost: number;
  overheadAmount: number;
  totalCost: number;
  profitAmount: number;
  repCommissionAmount: number;
  sellingPrice: number;
  actualProfitMargin: number;
}

export interface UseEstimatePricingReturn {
  lineItems: LineItem[];
  materialItems: LineItem[];
  laborItems: LineItem[];
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
};

export function useEstimatePricing(initialItems: LineItem[] = []): UseEstimatePricingReturn {
  const [lineItems, setLineItems] = useState<LineItem[]>(initialItems);
  const [config, setConfigState] = useState<PricingConfig>(DEFAULT_CONFIG);
  const [fixedPrice, setFixedPriceState] = useState<number | null>(null);

  const isFixedPrice = fixedPrice !== null && fixedPrice > 0;

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

  // Calculate pricing breakdown
  const breakdown = useMemo((): PricingBreakdown => {
    const materialsTotal = materialItems.reduce((sum, item) => sum + item.line_total, 0);
    const laborTotal = laborItems.reduce((sum, item) => sum + item.line_total, 0);
    const directCost = materialsTotal + laborTotal;
    
    const overheadAmount = directCost * (config.overheadPercent / 100);
    const totalCost = directCost + overheadAmount;

    let sellingPrice: number;
    let profitAmount: number;
    let actualProfitMargin: number;

    if (isFixedPrice) {
      // Fixed price mode: work backwards to calculate profit
      sellingPrice = fixedPrice!;
      profitAmount = sellingPrice - totalCost;
      actualProfitMargin = sellingPrice > 0 ? (profitAmount / sellingPrice) * 100 : 0;
    } else {
      // Standard mode: calculate selling price from margin
      // Formula: Price = Cost / (1 - Margin%)
      const marginDecimal = config.profitMarginPercent / 100;
      sellingPrice = marginDecimal < 1 ? totalCost / (1 - marginDecimal) : totalCost * 2;
      profitAmount = sellingPrice - totalCost;
      actualProfitMargin = config.profitMarginPercent;
    }

    const repCommissionAmount = sellingPrice * (config.repCommissionPercent / 100);

    return {
      materialsTotal,
      laborTotal,
      directCost,
      overheadAmount,
      totalCost,
      profitAmount,
      repCommissionAmount,
      sellingPrice,
      actualProfitMargin,
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
