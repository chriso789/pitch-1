// ============================================================
// Network Line Item Browser
// Search and browse line items across all tenants (anonymized)
// ============================================================

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Search, 
  Filter, 
  X, 
  TrendingUp, 
  DollarSign,
  BarChart3,
  Loader2,
  Database
} from 'lucide-react';
import { 
  useNetworkLineItemSearch, 
  NETWORK_UNITS, 
  NETWORK_CATEGORIES,
  type NetworkLineItem,
  type LineItemSearchFilters,
} from '@/hooks/useNetworkLineItemSearch';
import { useNetworkCarriers } from '@/hooks/useNetworkIntelligence';
import { getCarrierDisplayName } from '@/lib/insurance/canonicalItems';

interface NetworkLineItemBrowserProps {
  onSelectItem?: (item: NetworkLineItem) => void;
}

export const NetworkLineItemBrowser: React.FC<NetworkLineItemBrowserProps> = ({
  onSelectItem,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<LineItemSearchFilters>({
    limit: 50,
    offset: 0,
  });
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 500]);
  const [selectedItem, setSelectedItem] = useState<NetworkLineItem | null>(null);

  const { carriers } = useNetworkCarriers();
  
  const searchFilters: LineItemSearchFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch || undefined,
    min_price: priceRange[0] > 0 ? priceRange[0] : undefined,
    max_price: priceRange[1] < 500 ? priceRange[1] : undefined,
  }), [filters, debouncedSearch, priceRange]);

  const { data, isLoading } = useNetworkLineItemSearch(searchFilters);

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 400);
    return () => clearTimeout(timeout);
  };

  const handleFilterChange = (key: keyof LineItemSearchFilters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value === 'all' ? undefined : value,
      offset: 0, // Reset pagination on filter change
    }));
  };

  const clearFilters = () => {
    setFilters({ limit: 50, offset: 0 });
    setSearchInput('');
    setDebouncedSearch('');
    setPriceRange([0, 500]);
  };

  const hasActiveFilters = !!debouncedSearch || 
    !!filters.carrier_normalized || 
    !!filters.category || 
    !!filters.unit ||
    priceRange[0] > 0 || 
    priceRange[1] < 500;

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Network Line Items</CardTitle>
              <CardDescription>
                Search approved items across all carriers in the network
              </CardDescription>
            </div>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear Filters
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search line items (e.g., 'ridge cap', 'drip edge', 'shingle')..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="h-4 w-4 text-muted-foreground" />
          
          {/* Carrier Filter */}
          <Select 
            value={filters.carrier_normalized || 'all'} 
            onValueChange={(v) => handleFilterChange('carrier_normalized', v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Carrier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Carriers</SelectItem>
              {carriers.map(carrier => (
                <SelectItem key={carrier} value={carrier}>
                  {getCarrierDisplayName(carrier)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category Filter */}
          <Select 
            value={filters.category || 'all'} 
            onValueChange={(v) => handleFilterChange('category', v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {NETWORK_CATEGORIES.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Unit Filter */}
          <Select 
            value={filters.unit || 'all'} 
            onValueChange={(v) => handleFilterChange('unit', v)}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Units</SelectItem>
              {NETWORK_UNITS.map(unit => (
                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Price Range */}
          <div className="flex items-center gap-2 px-3 py-1 bg-muted rounded-md">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              ${priceRange[0]} - ${priceRange[1]}+
            </span>
            <Slider
              value={priceRange}
              onValueChange={(v) => setPriceRange(v as [number, number])}
              min={0}
              max={500}
              step={10}
              className="w-[120px]"
            />
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasActiveFilters ? (
          <div className="text-center py-12">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Search the Network</h3>
            <p className="text-muted-foreground">
              Enter a search term or select filters to find approved line items
            </p>
          </div>
        ) : data?.line_items && data.line_items.length > 0 ? (
          <>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead className="w-[80px]">Unit</TableHead>
                    <TableHead className="w-[100px] text-right">Price</TableHead>
                    <TableHead className="w-[100px] text-right">Avg Price</TableHead>
                    <TableHead className="w-[120px]">Carrier</TableHead>
                    <TableHead className="w-[80px] text-center">Freq</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.line_items.map((item) => (
                    <TableRow 
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSelectedItem(item);
                        onSelectItem?.(item);
                      }}
                    >
                      <TableCell className="font-medium max-w-[300px] truncate">
                        {item.raw_description}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono">
                        {item.raw_code || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {item.unit || 'EA'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(item.unit_price)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {formatCurrency(item.avg_price)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {getCarrierDisplayName(item.carrier_normalized || undefined)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge 
                          variant={item.network_frequency > 10 ? 'default' : 'outline'}
                          className="text-xs"
                        >
                          {item.network_frequency}x
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="text-sm text-muted-foreground text-center">
              Showing {data.line_items.length} of {data.total} items
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Results Found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search or filters
            </p>
          </div>
        )}
      </CardContent>

      {/* Item Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Line Item Details</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Description</p>
                <p className="font-medium">{selectedItem.raw_description}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Xactimate Code</p>
                  <p className="font-mono">{selectedItem.raw_code || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Unit</p>
                  <p>{selectedItem.unit || 'EA'}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Min Price</p>
                  <p className="font-mono text-lg">{formatCurrency(selectedItem.min_price)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Avg Price</p>
                  <p className="font-mono text-lg font-bold text-primary">
                    {formatCurrency(selectedItem.avg_price)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Max Price</p>
                  <p className="font-mono text-lg">{formatCurrency(selectedItem.max_price)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Carrier</p>
                  <Badge variant="secondary">
                    {getCarrierDisplayName(selectedItem.carrier_normalized || undefined)}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Network Frequency</p>
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="font-medium">{selectedItem.network_frequency}x</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
