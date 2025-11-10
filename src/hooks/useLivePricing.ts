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

      // Map the pricing data back to items
      const pricingMap = new Map(
        data.pricing?.map((p: any) => [p.sku, p]) || []
      );

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

        return {
          ...item,
          live_price: livePrice,
          price_variance_pct: priceVariance,
          price_source: liveData.source ? String(liveData.source) : 'api',
          price_age_hours: priceAge || undefined,
          last_price_updated: liveData.last_updated ? String(liveData.last_updated) : item.last_price_updated
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
