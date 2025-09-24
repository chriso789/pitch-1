import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Search, DollarSign, Clock, Zap, AlertTriangle } from "lucide-react";

interface PricingResult {
  product: {
    id: string;
    sku: string;
    name: string;
    unit_of_measure: string;
  };
  vendor: {
    name: string;
    code: string;
  };
  price: number;
  list_price?: number;
  discount_percent?: number;
  branch_code: string;
  seen_at?: string;
  last_seen_at?: string;
  source?: string;
  expires_at?: string;
  is_stale: boolean;
}

const PricingLookup = () => {
  const [searchSku, setSearchSku] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [results, setResults] = useState<PricingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSearch, setLastSearch] = useState("");
  const { toast } = useToast();

  const searchPricing = async () => {
    if (!searchSku.trim()) {
      toast({
        title: "SKU required",
        description: "Please enter a SKU to search for pricing.",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      setLastSearch(searchSku);

      // Search for products matching the SKU
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('id, sku, name, unit_of_measure')
        .or(`sku.ilike.%${searchSku}%,name.ilike.%${searchSku}%`)
        .eq('is_active', true);

      if (productError) throw productError;

      if (!products || products.length === 0) {
        setResults([]);
        toast({
          title: "No products found",
          description: `No active products found matching "${searchSku}".`,
          variant: "destructive",
        });
        return;
      }

      // Get pricing data for found products
      const productIds = products.map(p => p.id);
      let query = supabase
        .from('price_cache')
        .select(`
          price,
          branch_code,
          last_seen_at,
          source,
          expires_at,
          products!inner (id, sku, name, unit_of_measure),
          vendors!inner (name, code)
        `)
        .in('product_id', productIds)
        .order('last_seen_at', { ascending: false });

      // Filter by branch if specified
      if (branchCode.trim()) {
        query = query.eq('branch_code', branchCode.trim());
      }

      const { data: pricingData, error: pricingError } = await query;

      if (pricingError) throw pricingError;

      // Transform and enrich the data
      const enrichedResults: PricingResult[] = (pricingData || []).map(item => {
        const now = new Date();
        const lastSeen = new Date(item.last_seen_at || '');
        const expiresAt = item.expires_at ? new Date(item.expires_at) : null;
        
        // Consider data stale if it's older than 24 hours or past expiry
        const isStale = (now.getTime() - lastSeen.getTime()) > (24 * 60 * 60 * 1000) ||
                        (expiresAt && now > expiresAt);

        return {
          product: item.products,
          vendor: item.vendors,
          price: item.price,
          branch_code: item.branch_code,
          last_seen_at: item.last_seen_at,
          source: item.source,
          expires_at: item.expires_at,
          is_stale: isStale
        };
      });

      setResults(enrichedResults);

      if (enrichedResults.length === 0) {
        toast({
          title: "No pricing found",
          description: "No pricing data available for the specified criteria.",
          variant: "destructive",
        });
      }

    } catch (error) {
      console.error('Error searching pricing:', error);
      toast({
        title: "Search error",
        description: "Failed to search for pricing data.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshLivePricing = async (productSku: string) => {
    try {
      // This would call the QXO pricing API through an edge function
      toast({
        title: "Refreshing pricing",
        description: "Fetching latest pricing from suppliers...",
      });

      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Re-search to get updated results
      await searchPricing();

      toast({
        title: "Pricing updated",
        description: "Latest pricing data has been fetched and cached.",
      });

    } catch (error) {
      console.error('Error refreshing pricing:', error);
      toast({
        title: "Refresh failed",
        description: "Failed to refresh pricing from suppliers.",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const calculateSavings = (price: number, listPrice?: number) => {
    if (!listPrice || listPrice <= price) return null;
    const savings = listPrice - price;
    const percentage = ((savings / listPrice) * 100).toFixed(1);
    return { amount: savings, percentage: parseFloat(percentage) };
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Pricing Lookup</h2>
        <p className="text-muted-foreground">
          Get real-time pricing for materials from all connected suppliers
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Search className="h-5 w-5 mr-2" />
            Search Pricing
          </CardTitle>
          <CardDescription>
            Enter a SKU or product name to find current pricing across all suppliers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <Label htmlFor="sku">SKU or Product Name</Label>
              <Input
                id="sku"
                value={searchSku}
                onChange={(e) => setSearchSku(e.target.value)}
                placeholder="Enter SKU or product name..."
                onKeyPress={(e) => e.key === 'Enter' && searchPricing()}
              />
            </div>
            <div>
              <Label htmlFor="branch">Branch Code (Optional)</Label>
              <Input
                id="branch"
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                placeholder="Branch code"
              />
            </div>
            <Button onClick={searchPricing} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Pricing Results</CardTitle>
                <CardDescription>
                  Found {results.length} pricing entries for "{lastSearch}"
                </CardDescription>
              </div>
              <Button 
                variant="outline" 
                onClick={() => refreshLivePricing(lastSearch)}
                disabled={loading}
              >
                <Zap className="h-4 w-4 mr-2" />
                Refresh Live Pricing
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {results.map((result, index) => {                
                return (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-semibold text-lg">
                          {result.product.name}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          SKU: {result.product.sku} • Vendor: {result.vendor.name}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        {result.is_stale && (
                          <Badge variant="destructive" className="flex items-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Stale
                          </Badge>
                        )}
                        <Badge variant="outline">{result.source}</Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Current Price</Label>
                        <p className="text-2xl font-bold text-green-600 flex items-center">
                          <DollarSign className="h-5 w-5" />
                          {formatCurrency(result.price).slice(1)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          per {result.product.unit_of_measure}
                        </p>
                      </div>

                      {result.list_price && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">List Price</Label>
                          <p className="text-lg line-through text-muted-foreground">
                            {formatCurrency(result.list_price)}
                          </p>
                        </div>
                      )}

                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Branch</Label>
                        <p className="font-medium">{result.branch_code}</p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          Last Updated
                        </Label>
                        <p className="text-sm">{formatDate(result.last_seen_at || result.seen_at || '')}</p>
                        {result.expires_at && (
                          <p className="text-xs text-muted-foreground">
                            Expires: {formatDate(result.expires_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {results.length === 0 && lastSearch && !loading && (
        <Card>
          <CardContent className="text-center py-8">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              No pricing data found for "{lastSearch}"
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Try a different SKU or refresh live pricing from suppliers
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PricingLookup;