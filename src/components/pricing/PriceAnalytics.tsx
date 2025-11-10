import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, TrendingDown, AlertCircle, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PriceChange {
  sku: string;
  product_name: string;
  old_price: number;
  new_price: number;
  price_change_pct: number;
  changed_at: string;
}

interface AnalyticsSummary {
  totalChanges: number;
  avgPriceChange: number;
  priceIncreases: number;
  priceDecreases: number;
  volatileProducts: number;
}

export const PriceAnalytics = () => {
  const [recentChanges, setRecentChanges] = useState<PriceChange[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchPriceAnalytics();
  }, []);

  const fetchPriceAnalytics = async () => {
    try {
      // Fetch recent price changes (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: changes, error } = await supabase
        .from('price_history')
        .select('*')
        .gte('changed_at', sevenDaysAgo.toISOString())
        .order('changed_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      setRecentChanges(changes || []);

      // Calculate summary statistics
      if (changes && changes.length > 0) {
        const increases = changes.filter(c => c.price_change_pct > 0).length;
        const decreases = changes.filter(c => c.price_change_pct < 0).length;
        const avgChange = changes.reduce((sum, c) => sum + c.price_change_pct, 0) / changes.length;
        
        // Find products with multiple changes (volatile)
        const skuCounts = changes.reduce((acc, c) => {
          acc[c.sku] = (acc[c.sku] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const volatile = Object.values(skuCounts).filter(count => count > 2).length;

        setSummary({
          totalChanges: changes.length,
          avgPriceChange: avgChange,
          priceIncreases: increases,
          priceDecreases: decreases,
          volatileProducts: volatile,
        });
      }
    } catch (error) {
      console.error('Failed to fetch price analytics:', error);
      toast({
        title: "Error",
        description: "Failed to load price analytics",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-muted-foreground">Loading analytics...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Changes</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalChanges}</div>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Change</CardTitle>
              {summary.avgPriceChange >= 0 ? (
                <TrendingUp className="h-4 w-4 text-destructive" />
              ) : (
                <TrendingDown className="h-4 w-4 text-green-600" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatPercent(summary.avgPriceChange)}</div>
              <p className="text-xs text-muted-foreground">Average change</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Price Movements</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3 w-3 text-destructive" />
                  <span className="text-sm">{summary.priceIncreases} increases</span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-3 w-3 text-green-600" />
                  <span className="text-sm">{summary.priceDecreases} decreases</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Volatile Products</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.volatileProducts}</div>
              <p className="text-xs text-muted-foreground">3+ changes in 7 days</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Price Changes */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Price Changes</CardTitle>
          <CardDescription>
            Latest material price updates from vendor APIs
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentChanges.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              No price changes recorded yet. Run a price sync to start tracking changes.
            </div>
          ) : (
            <div className="space-y-4">
              {recentChanges.map((change) => (
                <div
                  key={change.sku + change.changed_at}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{change.product_name || change.sku}</p>
                    <p className="text-sm text-muted-foreground">SKU: {change.sku}</p>
                    <div className="flex items-center gap-2 text-sm">
                      <span>{formatCurrency(change.old_price)}</span>
                      <span>→</span>
                      <span className="font-medium">{formatCurrency(change.new_price)}</span>
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <Badge
                      variant={change.price_change_pct >= 0 ? "destructive" : "default"}
                      className="flex items-center gap-1"
                    >
                      {change.price_change_pct >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {formatPercent(change.price_change_pct)}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      {new Date(change.changed_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
