// ============================================================
// Line Item Mapping Review Component
// UI for reviewing and correcting low-confidence canonical mappings
// ============================================================

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Check, 
  X, 
  Search, 
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Filter,
  Sparkles
} from 'lucide-react';
import { useScopeLineItems, useCanonicalItems, useUpdateLineItemMapping } from '@/hooks/useScopeIntelligence';
import { ITEM_CATEGORIES } from '@/lib/insurance/canonicalItems';
import { cn } from '@/lib/utils';

interface LineItemMappingReviewProps {
  headerId: string;
  className?: string;
}

export const LineItemMappingReview: React.FC<LineItemMappingReviewProps> = ({
  headerId,
  className
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unmapped' | 'low_confidence'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const { data: lineItems, isLoading, refetch } = useScopeLineItems(headerId);
  const { data: canonicalItems } = useCanonicalItems();
  const updateMapping = useUpdateLineItemMapping();

  // Filter line items
  const filteredItems = useMemo(() => {
    if (!lineItems) return [];
    
    return lineItems.filter(item => {
      // Search filter
      const matchesSearch = !searchQuery || 
        item.raw_description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.raw_code?.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      let matchesStatus = true;
      if (filterStatus === 'unmapped') {
        matchesStatus = !item.canonical_item_id;
      } else if (filterStatus === 'low_confidence') {
        matchesStatus = !!item.canonical_item_id && (item.mapping_confidence || 0) < 0.85;
      }

      return matchesSearch && matchesStatus;
    });
  }, [lineItems, searchQuery, filterStatus]);

  // Group canonical items by category for selector
  const canonicalByCategory = useMemo(() => {
    if (!canonicalItems) return {};
    
    return canonicalItems.reduce((acc, item) => {
      const cat = item.category || 'General';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {} as Record<string, typeof canonicalItems>);
  }, [canonicalItems]);

  const handleApplyMapping = (lineItemId: string, canonicalItemId: string) => {
    updateMapping.mutate(
      { lineItemId, canonicalItemId },
      {
        onSuccess: () => {
          setEditingItemId(null);
          refetch();
        }
      }
    );
  };

  const getConfidenceBadge = (confidence: number | null, method: string | null) => {
    if (!confidence) {
      return <Badge variant="outline" className="text-muted-foreground">Unmapped</Badge>;
    }
    
    if (method === 'manual') {
      return <Badge className="bg-primary/10 text-primary border-primary/20">Manual</Badge>;
    }
    
    if (confidence >= 0.9) {
      return <Badge className="bg-green-100 text-green-700">High ({Math.round(confidence * 100)}%)</Badge>;
    }
    
    if (confidence >= 0.7) {
      return <Badge className="bg-amber-100 text-amber-700">Medium ({Math.round(confidence * 100)}%)</Badge>;
    }
    
    return <Badge className="bg-red-100 text-red-700">Low ({Math.round(confidence * 100)}%)</Badge>;
  };

  // Stats
  const stats = useMemo(() => {
    if (!lineItems) return { total: 0, mapped: 0, unmapped: 0, lowConfidence: 0 };
    
    const mapped = lineItems.filter(i => i.canonical_item_id);
    const lowConfidence = lineItems.filter(i => 
      i.canonical_item_id && (i.mapping_confidence || 0) < 0.85
    );
    
    return {
      total: lineItems.length,
      mapped: mapped.length,
      unmapped: lineItems.length - mapped.length,
      lowConfidence: lowConfidence.length
    };
  }, [lineItems]);

  if (isLoading) {
    return (
      <Card className={cn("", className)}>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading line items...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Line Item Mapping Review
            </CardTitle>
            <CardDescription>
              Review and correct canonical mappings for extracted line items
            </CardDescription>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>{stats.mapped} mapped</span>
            </div>
            <div className="flex items-center gap-2">
              <X className="h-4 w-4 text-muted-foreground" />
              <span>{stats.unmapped} unmapped</span>
            </div>
            {stats.lowConfidence > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>{stats.lowConfidence} low confidence</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by description or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items ({stats.total})</SelectItem>
              <SelectItem value="unmapped">Unmapped ({stats.unmapped})</SelectItem>
              <SelectItem value="low_confidence">Low Confidence ({stats.lowConfidence})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[120px]">Qty / Unit</TableHead>
                <TableHead className="w-[200px]">Canonical Mapping</TableHead>
                <TableHead className="w-[120px]">Confidence</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <p className="text-muted-foreground">No items match your filters</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.raw_code || '-'}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate" title={item.raw_description}>
                      {item.raw_description}
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.quantity} {item.unit}
                    </TableCell>
                    <TableCell>
                      {editingItemId === item.id ? (
                        <Select
                          onValueChange={(canonicalId) => handleApplyMapping(item.id, canonicalId)}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Select mapping..." />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {Object.entries(canonicalByCategory).map(([category, items]) => (
                              <React.Fragment key={category}>
                                <SelectItem value={`header-${category}`} disabled className="font-semibold text-xs text-muted-foreground">
                                  {category}
                                </SelectItem>
                                {items.map(canonical => (
                                  <SelectItem key={canonical.id} value={canonical.id!}>
                                    {canonical.display_name}
                                  </SelectItem>
                                ))}
                              </React.Fragment>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">
                          {item.canonical_item?.display_name || (
                            <span className="text-muted-foreground italic">Not mapped</span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {getConfidenceBadge(item.mapping_confidence || null, item.mapping_method || null)}
                    </TableCell>
                    <TableCell>
                      {editingItemId === item.id ? (
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setEditingItemId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingItemId(item.id)}
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Showing {filteredItems.length} of {stats.total} line items
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default LineItemMappingReview;
