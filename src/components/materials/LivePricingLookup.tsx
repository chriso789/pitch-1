import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, TrendingUp, TrendingDown, Minus, DollarSign, Package, AlertTriangle } from 'lucide-react';
import { useLivePricing } from '@/hooks/useLivePricing';
import { toast } from 'sonner';

interface PricingItem {
  sku?: string;
  item_description: string;
  quantity: number;
  unit_price: number;
  live_price?: number;
  price_variance_pct?: number;
  price_source?: string;
  last_price_updated?: string;
}

interface LivePricingLookupProps {
  items: PricingItem[];
  onPriceUpdate?: (items: PricingItem[]) => void;
  vendorId?: string;
  branchCode?: string;
}

const VENDORS = [
  { id: 'abc', name: 'ABC Supply' },
  { id: 'srs', name: 'SRS Distribution' },
  { id: 'qxo', name: 'QXO' },
  { id: 'beacon', name: 'Beacon' },
];

export const LivePricingLookup: React.FC<LivePricingLookupProps> = ({
  items,
  onPriceUpdate,
  vendorId: initialVendor,
  branchCode: initialBranch
}) => {
  const [pricedItems, setPricedItems] = useState<PricingItem[]>(items);
  const [selectedVendor, setSelectedVendor] = useState(initialVendor || '');
  const [branchCode, setBranchCode] = useState(initialBranch || '');
  const { fetchLivePricing, applyLivePricing, refreshing } = useLivePricing();

  const handleRefreshPricing = async () => {
    try {
      const result = await fetchLivePricing(pricedItems, selectedVendor, branchCode);
      setPricedItems(result);
      toast.success('Live pricing updated');
    } catch (error) {
      toast.error('Failed to fetch live pricing');
    }
  };

  const handleApplyPrices = () => {
    const updatedItems = applyLivePricing(pricedItems);
    setPricedItems(updatedItems);
    onPriceUpdate?.(updatedItems);
    toast.success('Prices applied to estimate');
  };

  const getPriceVarianceIcon = (variance?: number) => {
    if (!variance) return <Minus className="h-4 w-4 text-muted-foreground" />;
    if (variance > 5) return <TrendingUp className="h-4 w-4 text-destructive" />;
    if (variance < -5) return <TrendingDown className="h-4 w-4 text-green-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getPriceVarianceBadge = (variance?: number) => {
    if (!variance) return null;
    const absVariance = Math.abs(variance);
    if (absVariance < 1) return null;
    
    return (
      <Badge 
        variant={variance > 5 ? 'destructive' : variance < -5 ? 'default' : 'secondary'}
        className="ml-2"
      >
        {variance > 0 ? '+' : ''}{variance.toFixed(1)}%
      </Badge>
    );
  };

  const totalEstimate = pricedItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
  const totalLive = pricedItems.reduce((sum, item) => sum + ((item.live_price || item.unit_price) * item.quantity), 0);
  const totalVariance = totalEstimate > 0 ? ((totalLive - totalEstimate) / totalEstimate) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Live Material Pricing
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedVendor} onValueChange={setSelectedVendor}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {VENDORS.map(vendor => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Branch code"
              value={branchCode}
              onChange={(e) => setBranchCode(e.target.value)}
              className="w-28"
            />
            <Button 
              onClick={handleRefreshPricing} 
              disabled={refreshing}
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Est. Price</TableHead>
              <TableHead className="text-right">Live Price</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Line Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pricedItems.map((item, index) => (
              <TableRow key={index}>
                <TableCell className="font-mono text-sm">
                  {item.sku || '-'}
                </TableCell>
                <TableCell>{item.item_description}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right">
                  ${item.unit_price.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  {item.live_price ? (
                    <span className="font-medium">
                      ${item.live_price.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {getPriceVarianceIcon(item.price_variance_pct)}
                    {getPriceVarianceBadge(item.price_variance_pct)}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${((item.live_price || item.unit_price) * item.quantity).toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 p-4 bg-muted rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Estimated Total</p>
              <p className="text-xl font-bold">${totalEstimate.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Variance</p>
              <div className="flex items-center justify-center gap-1">
                {getPriceVarianceIcon(totalVariance)}
                <span className={`text-xl font-bold ${totalVariance > 5 ? 'text-destructive' : totalVariance < -5 ? 'text-green-500' : ''}`}>
                  {totalVariance > 0 ? '+' : ''}{totalVariance.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Live Total</p>
              <p className="text-xl font-bold">${totalLive.toFixed(2)}</p>
            </div>
          </div>

          {Math.abs(totalVariance) > 5 && (
            <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950 rounded-md flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">Price Alert</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {totalVariance > 0 
                    ? 'Material costs have increased significantly. Consider updating your estimate.'
                    : 'Material costs have decreased. You may have room for better margins.'}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPricedItems(items)}>
              Reset
            </Button>
            <Button onClick={handleApplyPrices}>
              <Package className="h-4 w-4 mr-2" />
              Apply Live Prices
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
