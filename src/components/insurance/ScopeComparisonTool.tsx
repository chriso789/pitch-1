// ============================================================
// Scope Comparison Tool
// Upload a scope and compare against network to find missing items
// ============================================================

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  DollarSign,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Loader2,
  ArrowRight,
  BarChart3,
  Package
} from 'lucide-react';
import { useScopeDocuments } from '@/hooks/useScopeIntelligence';
import { useScopeComparison, type ComparisonResult } from '@/hooks/useScopeComparison';
import { useNetworkCarriers } from '@/hooks/useNetworkIntelligence';
import { getCarrierDisplayName } from '@/lib/insurance/canonicalItems';

interface ScopeComparisonToolProps {
  onBuildSupplement?: (items: ComparisonResult['missing_items']) => void;
}

export const ScopeComparisonTool: React.FC<ScopeComparisonToolProps> = ({
  onBuildSupplement,
}) => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [carrierFilter, setCarrierFilter] = useState<string | undefined>();
  const [matchedOpen, setMatchedOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(true);
  const [discrepanciesOpen, setDiscrepanciesOpen] = useState(true);
  const [selectedMissingItems, setSelectedMissingItems] = useState<Set<string>>(new Set());

  const { data: documents } = useScopeDocuments();
  const { carriers } = useNetworkCarriers();
  const { data: comparison, isLoading, error } = useScopeComparison(
    selectedDocumentId,
    carrierFilter
  );

  // Filter to completed documents only
  const completedDocs = documents?.filter(d => d.parse_status === 'complete') || [];

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(0)}%`;
  };

  const toggleMissingItem = (key: string) => {
    const newSelected = new Set(selectedMissingItems);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedMissingItems(newSelected);
  };

  const selectAllMissing = () => {
    if (!comparison?.missing_items) return;
    setSelectedMissingItems(new Set(comparison.missing_items.map(m => m.canonical_key)));
  };

  const handleBuildSupplement = () => {
    if (!comparison?.missing_items || !onBuildSupplement) return;
    const selected = comparison.missing_items.filter(m => 
      selectedMissingItems.has(m.canonical_key)
    );
    onBuildSupplement(selected);
  };

  return (
    <div className="space-y-6">
      {/* Document Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Scope Comparison Tool
          </CardTitle>
          <CardDescription>
            Select a parsed scope to compare against the network database and identify missing items
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Select Scope Document</label>
              <Select 
                value={selectedDocumentId || ''} 
                onValueChange={setSelectedDocumentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a parsed scope..." />
                </SelectTrigger>
                <SelectContent>
                  {completedDocs.map(doc => (
                    <SelectItem key={doc.id} value={doc.id}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>{doc.file_name}</span>
                        {doc.carrier_normalized && (
                          <Badge variant="outline" className="text-xs">
                            {getCarrierDisplayName(doc.carrier_normalized)}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[200px]">
              <label className="text-sm font-medium mb-2 block">Compare Against Carrier</label>
              <Select 
                value={carrierFilter || 'auto'} 
                onValueChange={(v) => setCarrierFilter(v === 'auto' ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect from scope</SelectItem>
                  {carriers.map(carrier => (
                    <SelectItem key={carrier} value={carrier}>
                      {getCarrierDisplayName(carrier)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Analyzing scope against network...</p>
            <Progress value={60} className="w-48 mx-auto mt-4" />
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to analyze scope: {error.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {comparison && !isLoading && (
        <>
          {/* Summary Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-2xl font-bold">{comparison.scope_summary.total_items}</p>
                      <p className="text-xs text-muted-foreground">Line Items</p>
                    </div>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-2xl font-bold">
                        {formatCurrency(comparison.scope_summary.total_rcv)}
                      </p>
                      <p className="text-xs text-muted-foreground">Total RCV</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {comparison.scope_summary.carrier_detected && (
                    <Badge variant="secondary">
                      {getCarrierDisplayName(comparison.scope_summary.carrier_detected)}
                    </Badge>
                  )}
                  {comparison.scope_summary.state_detected && (
                    <Badge variant="outline">
                      {comparison.scope_summary.state_detected}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Matched Items */}
          <Collapsible open={matchedOpen} onOpenChange={setMatchedOpen}>
            <Card>
              <CardHeader className="cursor-pointer" onClick={() => setMatchedOpen(!matchedOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {matchedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <CardTitle className="text-base">
                        Matched Items ({comparison.matched_items.length})
                      </CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-700">
                      Found in Network
                    </Badge>
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    These items in your scope match patterns found in the network database
                  </p>
                  {comparison.matched_items.length > 0 ? (
                    <div className="rounded-md border max-h-[300px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Your Price</TableHead>
                            <TableHead className="text-right">Network Avg</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparison.matched_items.slice(0, 20).map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="max-w-[300px] truncate">
                                {item.description}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(item.unit_price)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatCurrency(item.network_avg_price)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No matched items found
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Missing Items */}
          <Collapsible open={missingOpen} onOpenChange={setMissingOpen}>
            <Card className="border-amber-200">
              <CardHeader className="cursor-pointer" onClick={() => setMissingOpen(!missingOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {missingOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      <CardTitle className="text-base">
                        Missing Items ({comparison.missing_items.length})
                      </CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-amber-50 text-amber-700">
                      Commonly Paid by Carrier
                    </Badge>
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    These items are commonly paid by {comparison.scope_summary.carrier_detected || 'this carrier'} but are not in your scope
                  </p>
                  {comparison.missing_items.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <Button variant="outline" size="sm" onClick={selectAllMissing}>
                          Select All
                        </Button>
                        {selectedMissingItems.size > 0 && onBuildSupplement && (
                          <Button size="sm" onClick={handleBuildSupplement}>
                            <Package className="h-4 w-4 mr-2" />
                            Add {selectedMissingItems.size} to Supplement
                          </Button>
                        )}
                      </div>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[40px]"></TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="w-[80px]">Unit</TableHead>
                              <TableHead className="text-right">Suggested Price</TableHead>
                              <TableHead className="text-right">Paid Rate</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {comparison.missing_items.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedMissingItems.has(item.canonical_key)}
                                    onCheckedChange={() => toggleMissingItem(item.canonical_key)}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{item.description}</p>
                                    {item.raw_code && (
                                      <p className="text-xs text-muted-foreground font-mono">
                                        {item.raw_code}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {item.unit || 'EA'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatCurrency(item.suggested_unit_price)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <TrendingUp className="h-3 w-3 text-green-600" />
                                    <span className="font-medium text-green-600">
                                      {formatPercent(item.network_paid_rate)}
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No commonly missing items found - your scope appears comprehensive!
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Price Discrepancies */}
          <Collapsible open={discrepanciesOpen} onOpenChange={setDiscrepanciesOpen}>
            <Card>
              <CardHeader className="cursor-pointer" onClick={() => setDiscrepanciesOpen(!discrepanciesOpen)}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {discrepanciesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <DollarSign className="h-5 w-5 text-blue-600" />
                      <CardTitle className="text-base">
                        Price Discrepancies ({comparison.price_discrepancies.length})
                      </CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700">
                      Below Network Average
                    </Badge>
                  </div>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Items in your scope priced significantly different from network averages
                  </p>
                  {comparison.price_discrepancies.length > 0 ? (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Your Price</TableHead>
                            <TableHead className="text-center"></TableHead>
                            <TableHead className="text-right">Network Avg</TableHead>
                            <TableHead className="text-right">Difference</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparison.price_discrepancies.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="max-w-[250px] truncate">
                                {item.description}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(item.scope_price)}
                              </TableCell>
                              <TableCell className="text-center">
                                <ArrowRight className="h-4 w-4 text-muted-foreground inline" />
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatCurrency(item.network_avg_price)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Badge 
                                  variant={item.difference_percent < 0 ? 'destructive' : 'default'}
                                  className="font-mono"
                                >
                                  {item.difference_percent < 0 ? (
                                    <TrendingDown className="h-3 w-3 mr-1" />
                                  ) : (
                                    <TrendingUp className="h-3 w-3 mr-1" />
                                  )}
                                  {item.difference_percent.toFixed(0)}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No significant price discrepancies found
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </>
      )}

      {/* Empty State */}
      {!selectedDocumentId && !isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Select a Scope to Compare</h3>
            <p className="text-muted-foreground mb-4">
              Choose a parsed scope document above to compare it against the network database
              and identify potentially missing line items.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
