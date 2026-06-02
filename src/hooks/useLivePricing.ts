import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PricingItem {
  sku?: string;
  item_description: string;
  quantity: number;
  unit_price: number;
  last_price_updated?: string;
}

interface LivePricingResult extends PricingItem {
  live_price?: number;
  price_variance_pct?: number;
  price_source?: string;
  price_age_hours?: number;
}

export const useLivePricing = () => {
  const [refreshing, setRefreshing] = useState(false);

  const fetchLivePricing = async (
    items: PricingItem[],
    vendorId?: string,
    branchCode?: string
  ): Promise<LivePricingResult[]> => {
    setRefreshing(true);
    try {
      // Extract SKUs from items
      const skus = items
        .filter(item => item.sku)
        .map(item => item.sku as string);

      if (skus.length === 0) {
        console.warn('No SKUs found in items, skipping live pricing fetch');
        return items;
      }

      // Call material-pricing-api with refresh=true to get live prices
      const { data, error } = await supabase.functions.invoke('material-pricing-api', {
        body: {
          skus,
          branch: branchCode,
          vendors: vendorId ? [vendorId] : undefined,
          refresh: true
        }
      });

      if (error) {
        console.error('Error fetching live pricing:', error);
        throw error;
      }

      // material-pricing-api returns `{ success, results: PricingResponse[], ... }`.
      // Each result has `sku`, `price`, `source`, `lastUpdated` (camelCase).
      const rawResults: any[] = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.pricing) // legacy fallback
          ? data.pricing
          : [];

      // If multiple vendors return the same SKU, keep the most recent.
      const pricingMap = new Map<string, any>();
      for (const r of rawResults) {
        if (!r?.sku) continue;
        const existing = pricingMap.get(r.sku);
        if (!existing) {
          pricingMap.set(r.sku, r);
          continue;
        }
        const existingTs = new Date(existing.lastUpdated ?? existing.last_updated ?? 0).getTime();
        const nextTs = new Date(r.lastUpdated ?? r.last_updated ?? 0).getTime();
        if (nextTs >= existingTs) pricingMap.set(r.sku, r);
      }

      const enrichedItems: LivePricingResult[] = items.map(item => {
        if (!item.sku) return item;

        const liveData = pricingMap.get(item.sku) as any;
        if (!liveData) return item;

        const livePrice = typeof liveData.price === 'number' ? liveData.price : item.unit_price;
        const priceVariance = item.unit_price > 0
          ? ((livePrice - item.unit_price) / item.unit_price) * 100
          : 0;

        // Calculate price age
        const priceAge = item.last_price_updated
          ? (new Date().getTime() - new Date(item.last_price_updated).getTime()) / (1000 * 60 * 60)
          : null;

        const lastUpdatedRaw = liveData.lastUpdated ?? liveData.last_updated;

        return {
          ...item,
          live_price: livePrice,
          price_variance_pct: priceVariance,
          price_source: liveData.source ? String(liveData.source) : 'api',
          price_age_hours: priceAge || undefined,
          last_price_updated: lastUpdatedRaw ? String(lastUpdatedRaw) : item.last_price_updated
        };
      });


      return enrichedItems;
    } catch (error: any) {
      console.error('Error in fetchLivePricing:', error);
      toast.error(error.message || 'Failed to fetch live pricing');
      return items; // Return original items on error
    } finally {
      setRefreshing(false);
    }
  };

  const applyLivePricing = (items: LivePricingResult[]): LivePricingResult[] => {
    return items.map(item => ({
      ...item,
      unit_price: item.live_price || item.unit_price
    }));
  };

  return {
    fetchLivePricing,
    applyLivePricing,
    refreshing
  };
};
