import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface PricingItem {
  sku?: string;
  item_description: string;
  quantity: number;
  unit_price: number;
  last_price_updated?: string;
  live_price?: number;
  price_variance_pct?: number;
}

interface LivePricingStatusProps {
  items: PricingItem[];
  onRefreshPricing?: () => void;
  refreshing?: boolean;
}

export const LivePricingStatus: React.FC<LivePricingStatusProps> = ({
  items,
  onRefreshPricing,
  refreshing = false
}) => {
  // Calculate pricing statistics
  const now = new Date();
  const stalePrices = items.filter(item => {
    if (!item.last_price_updated) return true;
    const priceAge = now.getTime() - new Date(item.last_price_updated).getTime();
    return priceAge > 24 * 60 * 60 * 1000; // 24 hours
  });

  const significantVariances = items.filter(item => 
    item.price_variance_pct && Math.abs(item.price_variance_pct) > 5
  );

  const totalItems = items.length;
  const freshPrices = totalItems - stalePrices.length;
  const avgVariance = items.reduce((sum, item) => 
    sum + (Math.abs(item.price_variance_pct || 0)), 0
  ) / totalItems;

  const getPricingHealthStatus = () => {
    if (stalePrices.length === 0 && significantVariances.length === 0) {
      return {
        status: 'excellent',
        icon: CheckCircle,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        message: 'All prices are current and accurate'
      };
    } else if (stalePrices.length > totalItems / 2) {
      return {
        status: 'critical',
        icon: AlertTriangle,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        message: 'Most prices are stale - refresh recommended'
      };
    } else if (significantVariances.length > 0) {
      return {
        status: 'warning',
        icon: AlertTriangle,
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        message: 'Significant price changes detected'
      };
    } else {
      return {
        status: 'fair',
        icon: Clock,
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
        message: 'Some prices need updating'
      };
    }
  };

  const healthStatus = getPricingHealthStatus();
  const HealthIcon = healthStatus.icon;

  return (
    <div className={`border rounded-lg p-4 ${healthStatus.bgColor} ${healthStatus.borderColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <HealthIcon className={`h-5 w-5 ${healthStatus.color}`} />
          <div>
            <h4 className="font-semibold text-sm">Pricing Status</h4>
            <p className={`text-xs ${healthStatus.color}`}>{healthStatus.message}</p>
          </div>
        </div>
        
        {onRefreshPricing && (
          <button
            onClick={onRefreshPricing}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-background rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Prices'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-background/50 rounded p-2">
          <div className="text-xs text-muted-foreground">Fresh Prices</div>
          <div className="font-semibold">
            {freshPrices} / {totalItems}
          </div>
          <Badge variant="outline" className="mt-1 text-xs">
            {totalItems > 0 ? Math.round((freshPrices / totalItems) * 100) : 0}%
          </Badge>
        </div>

        <div className="bg-background/50 rounded p-2">
          <div className="text-xs text-muted-foreground">Stale Prices</div>
          <div className="font-semibold text-orange-600">
            {stalePrices.length}
          </div>
          {stalePrices.length > 0 && (
            <Badge variant="outline" className="mt-1 text-xs bg-orange-100">
              &gt;24h old
            </Badge>
          )}
        </div>

        <div className="bg-background/50 rounded p-2">
          <div className="text-xs text-muted-foreground">Avg Variance</div>
          <div className="font-semibold">
            {avgVariance.toFixed(1)}%
          </div>
          {significantVariances.length > 0 && (
            <Badge variant="outline" className="mt-1 text-xs bg-yellow-100">
              {significantVariances.length} items &gt;5%
            </Badge>
          )}
        </div>
      </div>

      {stalePrices.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="text-xs font-medium mb-2">Stale Items:</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {stalePrices.slice(0, 5).map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs bg-background/50 rounded px-2 py-1">
                <span className="truncate flex-1">{item.item_description}</span>
                <Badge variant="outline" className="ml-2 text-xs">
                  {item.last_price_updated 
                    ? formatDistanceToNow(new Date(item.last_price_updated), { addSuffix: true })
                    : 'Never updated'
                  }
                </Badge>
              </div>
            ))}
            {stalePrices.length > 5 && (
              <div className="text-xs text-muted-foreground text-center py-1">
                +{stalePrices.length - 5} more stale items
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
