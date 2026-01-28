// Pricing calculations hook with fixed price override support
// Supports both profit_split (commission from net profit) and sales_percentage (commission from sale)
import { useState, useCallback, useMemo, useEffect } from 'react';

export interface LineItem {
  id: string;
  item_name: string;
  description?: string;           // Product description for consumer-facing PDFs
  notes?: string;                 // Color/specs for supplier orders
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
  sellingPrice: number;
  actualProfitMargin: number;
  // Sales tax (applied to materials portion only - labor is tax-exempt)
  materialsSellingPortion: number; // Materials portion of selling price for tax calculation
  salesTaxAmount: number;
  totalWithTax: number;
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

  // Calculate pricing breakdown
  // Overhead and Profit are both percentages of SELLING PRICE
  // Formula: Selling Price = Direct Cost / (1 - OH% - Profit%)
  // Commission calculation respects commission structure:
  //   - profit_split: Commission = Net Profit × Rate %
  //   - sales_percentage: Commission = Selling Price × Rate %
  const breakdown = useMemo((): PricingBreakdown => {
    const materialsTotal = materialItems.reduce((sum, item) => sum + item.line_total, 0);
    const laborTotal = laborItems.reduce((sum, item) => sum + item.line_total, 0);
    const directCost = materialsTotal + laborTotal;
    
    let sellingPrice: number;
    let overheadAmount: number;
    let profitAmount: number;
    let actualProfitMargin: number;

    if (isFixedPrice) {
      // Fixed price mode: work backwards
      sellingPrice = fixedPrice!;
      overheadAmount = sellingPrice * (config.overheadPercent / 100);
      profitAmount = sellingPrice - directCost - overheadAmount;
      actualProfitMargin = sellingPrice > 0 ? (profitAmount / sellingPrice) * 100 : 0;
    } else {
      // Standard mode: solve for selling price algebraically
      const overheadDecimal = config.overheadPercent / 100;
      const profitDecimal = config.profitMarginPercent / 100;
      const divisor = 1 - overheadDecimal - profitDecimal;
      
      // Prevent division by zero or negative (if OH + Profit >= 100%)
      if (divisor <= 0) {
        sellingPrice = directCost * 3; // Fallback
      } else {
        sellingPrice = directCost / divisor;
      }
      
      overheadAmount = sellingPrice * overheadDecimal;
      profitAmount = sellingPrice * profitDecimal;
      actualProfitMargin = config.profitMarginPercent;
    }

    const totalCost = directCost + overheadAmount; // For display: cost before profit
    
    // Net profit = Selling Price - Direct Cost - Overhead
    const netProfit = sellingPrice - directCost - overheadAmount;
    
    // Calculate commission based on structure type
    let repCommissionAmount: number;
    if (config.commissionStructure === 'profit_split') {
      // Commission is a percentage of net profit
      repCommissionAmount = Math.max(0, netProfit * (config.repCommissionPercent / 100));
    } else {
      // Commission is a percentage of selling price
      repCommissionAmount = sellingPrice * (config.repCommissionPercent / 100);
    }

    // Calculate sales tax (applied to MATERIALS portion only - labor is tax-exempt)
    // Proportionally allocate selling price between materials and labor based on direct cost ratio
    const materialsRatio = directCost > 0 ? materialsTotal / directCost : 0;
    const materialsSellingPortion = sellingPrice * materialsRatio;
    const salesTaxAmount = config.salesTaxEnabled 
      ? materialsSellingPortion * (config.salesTaxRate / 100) 
      : 0;
    const totalWithTax = sellingPrice + salesTaxAmount;

    return {
      materialsTotal,
      laborTotal,
      directCost,
      overheadAmount,
      totalCost,
      profitAmount,
      netProfit,
      repCommissionAmount,
      sellingPrice,
      actualProfitMargin,
      materialsSellingPortion,
      salesTaxAmount,
      totalWithTax,
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
