import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface PriceLockItem {
  item_description: string;
  quantity: number;
  unit_price: number;
  price_locked_at?: string;
  price_fetched_from?: string;
  price_age_at_lock_hours?: number;
  live_unit_price?: number;
  price_variance_pct?: number;
}

interface PriceLockStatusProps {
  items: PriceLockItem[];
}

export const PriceLockStatus: React.FC<PriceLockStatusProps> = ({ items }) => {
  const lockedItems = items.filter(item => item.price_locked_at);

  if (lockedItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Price Lock Status
          </CardTitle>
          <CardDescription>
            No price lock information available for this order
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const totalVariance = lockedItems.reduce(
    (sum, item) => sum + (item.price_variance_pct || 0),
    0
  );
  const avgVariance = totalVariance / lockedItems.length;

  const significantChanges = lockedItems.filter(
    item => item.price_variance_pct && Math.abs(item.price_variance_pct) > 5
  );

  const stalePrices = lockedItems.filter(
    item => item.price_age_at_lock_hours && item.price_age_at_lock_hours > 24
  );

  const getVarianceColor = (variance?: number) => {
    if (!variance) return 'text-muted-foreground';
    if (Math.abs(variance) < 2) return 'text-green-600';
    if (Math.abs(variance) < 5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getVarianceIcon = (variance?: number) => {
    if (!variance || Math.abs(variance) < 0.01) return null;
    return variance > 0 ? (
      <TrendingUp className="h-3 w-3 text-red-500" />
    ) : (
      <TrendingDown className="h-3 w-3 text-green-500" />
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Price Lock Status
        </CardTitle>
        <CardDescription>
          Prices were locked at PO creation time to ensure accurate costs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Locked Items</div>
            <div className="text-2xl font-bold">{lockedItems.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              of {items.length} total items
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Avg Price Change</div>
            <div className={`text-2xl font-bold ${getVarianceColor(avgVariance)}`}>
              {avgVariance > 0 ? '+' : ''}
              {avgVariance.toFixed(1)}%
            </div>
            {significantChanges.length > 0 && (
              <div className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {significantChanges.length} significant changes
              </div>
            )}
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Price Source</div>
            <div className="text-sm font-semibold mt-1">
              {lockedItems[0]?.price_fetched_from === 'srs-api' ? (
                <Badge variant="default">Live API</Badge>
              ) : lockedItems[0]?.price_fetched_from === 'cache' ? (
                <Badge variant="secondary">Cache</Badge>
              ) : (
                <Badge variant="outline">Manual</Badge>
              )}
            </div>
            {stalePrices.length > 0 && (
              <div className="text-xs text-orange-600 mt-1">
                {stalePrices.length} stale at lock
              </div>
            )}
          </div>
        </div>

        {/* Lock Timestamp */}
        {lockedItems[0]?.price_locked_at && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Lock className="h-4 w-4" />
            <span>
              Prices locked{' '}
              {formatDistanceToNow(new Date(lockedItems[0].price_locked_at), {
                addSuffix: true
              })}
            </span>
          </div>
        )}

        {/* Items with Significant Changes */}
        {significantChanges.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Significant Price Changes at Lock
            </h4>
            <div className="space-y-2">
              {significantChanges.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-sm bg-yellow-50 border border-yellow-200 rounded p-2"
                >
                  <div className="flex-1">
                    <div className="font-medium">{item.item_description}</div>
                    <div className="text-xs text-muted-foreground">
                      Qty: {item.quantity} × ${item.unit_price.toFixed(2)}
                      {item.live_unit_price && (
                        <span className="ml-2">
                          (was ${item.live_unit_price.toFixed(2)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {getVarianceIcon(item.price_variance_pct)}
                    <Badge
                      variant="outline"
                      className={getVarianceColor(item.price_variance_pct)}
                    >
                      {item.price_variance_pct && item.price_variance_pct > 0 ? '+' : ''}
                      {item.price_variance_pct?.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
