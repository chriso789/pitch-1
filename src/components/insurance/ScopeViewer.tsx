// ============================================================
// Scope Viewer Component
// PDF viewer with evidence highlighting and line item panel
// ============================================================

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  DollarSign, 
  List, 
  CheckCircle, 
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Download
} from 'lucide-react';
import { useScopeDocument, useScopeHeader, useScopeLineItems } from '@/hooks/useScopeIntelligence';
import { 
  getCarrierDisplayName, 
  getParseStatusInfo, 
  getDocumentTypeLabel,
  ITEM_CATEGORIES 
} from '@/lib/insurance/canonicalItems';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import MobilePDFViewer from '@/components/ui/MobilePDFViewer';

interface ScopeViewerProps {
  documentId: string;
  onClose?: () => void;
  className?: string;
}

export const ScopeViewer: React.FC<ScopeViewerProps> = ({
  documentId,
  onClose,
  className,
}) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [selectedLineItem, setSelectedLineItem] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const { data: document, isLoading: docLoading } = useScopeDocument(documentId);
  const { data: header, isLoading: headerLoading } = useScopeHeader(documentId);
  const { data: lineItems, isLoading: itemsLoading } = useScopeLineItems(header?.id);

  // Get signed URL for PDF
  useEffect(() => {
    if (document?.storage_path) {
      supabase.storage
        .from('documents')
        .createSignedUrl(document.storage_path, 3600)
        .then(({ data, error }) => {
          if (data?.signedUrl) {
            setPdfUrl(data.signedUrl);
          }
        });
    }
  }, [document?.storage_path]);

  const statusInfo = document ? getParseStatusInfo(document.parse_status) : null;

  // Group line items by category
  const itemsByCategory = useMemo(() => {
    if (!lineItems) return {};
    const grouped: Record<string, typeof lineItems> = {};
    
    for (const item of lineItems) {
      const category = item.canonical_item?.category || item.section_name || 'Uncategorized';
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(item);
    }
    
    return grouped;
  }, [lineItems]);

  // Filter line items
  const filteredItems = useMemo(() => {
    if (!lineItems) return [];
    if (!categoryFilter) return lineItems;
    return lineItems.filter(item => {
      const category = item.canonical_item?.category || item.section_name;
      return category === categoryFilter;
    });
  }, [lineItems, categoryFilter]);

  // Calculate totals
  const calculatedTotals = useMemo(() => {
    if (!lineItems) return { rcv: 0, acv: 0, depreciation: 0 };
    return lineItems.reduce((acc, item) => ({
      rcv: acc.rcv + (item.total_rcv || 0),
      acv: acc.acv + (item.total_acv || 0),
      depreciation: acc.depreciation + (item.depreciation_amount || 0),
    }), { rcv: 0, acv: 0, depreciation: 0 });
  }, [lineItems]);

  // Mapping stats
  const mappingStats = useMemo(() => {
    if (!lineItems) return { mapped: 0, total: 0, percentage: 0 };
    const mapped = lineItems.filter(i => i.canonical_item_id).length;
    return {
      mapped,
      total: lineItems.length,
      percentage: lineItems.length > 0 ? Math.round((mapped / lineItems.length) * 100) : 0,
    };
  }, [lineItems]);

  const isLoading = docLoading || headerLoading || itemsLoading;

  if (isLoading) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!document) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Document not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <Card className="rounded-b-none border-b-0">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {document.file_name}
              </CardTitle>
              <CardDescription className="mt-1">
                {getDocumentTypeLabel(document.document_type)}
                {document.carrier_name && (
                  <> • {getCarrierDisplayName(document.carrier_normalized)}</>
                )}
                {document.claim_number_detected && (
                  <> • Claim #{document.claim_number_detected}</>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {statusInfo && (
                <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
              )}
              {onClose && (
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Totals Summary */}
          {header && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
              <div>
                <p className="text-xs text-muted-foreground">RCV Total</p>
                <p className="text-lg font-semibold text-primary">
                  ${(header.total_rcv || calculatedTotals.rcv).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ACV Total</p>
                <p className="text-lg font-semibold">
                  ${(header.total_acv || calculatedTotals.acv).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Depreciation</p>
                <p className="text-lg font-semibold text-destructive">
                  ${(header.total_depreciation || calculatedTotals.depreciation).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Line Items</p>
                <p className="text-lg font-semibold">
                  {lineItems?.length || 0}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    ({mappingStats.percentage}% mapped)
                  </span>
                </p>
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-0">
        {/* PDF Viewer */}
        <Card className="rounded-t-none rounded-r-none border-t-0 lg:border-r-0">
          <CardContent className="p-0 h-full">
            {pdfUrl ? (
              <MobilePDFViewer 
                url={pdfUrl} 
                title={document.file_name}
                filename={document.file_name}
                className="h-full min-h-[400px]"
              />
            ) : (
              <div className="flex items-center justify-center h-full min-h-[400px] bg-muted/30">
                <p className="text-muted-foreground">Loading PDF...</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Line Items Panel */}
        <Card className="rounded-t-none rounded-l-none border-t-0">
          <Tabs defaultValue="items" className="h-full flex flex-col">
            <div className="px-4 pt-4">
              <TabsList className="w-full">
                <TabsTrigger value="items" className="flex-1">
                  <List className="h-4 w-4 mr-2" />
                  Line Items
                </TabsTrigger>
                <TabsTrigger value="totals" className="flex-1">
                  <DollarSign className="h-4 w-4 mr-2" />
                  Totals
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="items" className="flex-1 min-h-0 m-0">
              {/* Category Filter */}
              <div className="px-4 py-2 flex flex-wrap gap-1 border-b">
                <Badge 
                  variant={categoryFilter === null ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setCategoryFilter(null)}
                >
                  All ({lineItems?.length || 0})
                </Badge>
                {Object.entries(itemsByCategory).map(([category, items]) => (
                  <Badge 
                    key={category}
                    variant={categoryFilter === category ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setCategoryFilter(category)}
                  >
                    {category} ({items.length})
                  </Badge>
                ))}
              </div>

              {/* Items Table */}
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right w-20">Qty</TableHead>
                      <TableHead className="text-right w-24">RCV</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow 
                        key={item.id}
                        className={cn(
                          "cursor-pointer hover:bg-muted/50",
                          selectedLineItem === item.id && "bg-primary/10"
                        )}
                        onClick={() => setSelectedLineItem(item.id)}
                      >
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-sm line-clamp-2">
                              {item.canonical_item?.display_name || item.raw_description}
                            </p>
                            {item.raw_code && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {item.raw_code}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.quantity} {item.unit}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          ${(item.total_rcv || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          {item.canonical_item_id ? (
                            <CheckCircle className="h-4 w-4 text-primary" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="totals" className="flex-1 m-0 p-4">
              <div className="space-y-4">
                {header ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="text-xs text-muted-foreground">Replacement Cost Value</p>
                        <p className="text-xl font-bold text-primary">
                          ${(header.total_rcv || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="text-xs text-muted-foreground">Actual Cash Value</p>
                        <p className="text-xl font-bold">
                          ${(header.total_acv || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Depreciation</span>
                        <span className="text-destructive">
                          -${(header.total_depreciation || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      {header.recoverable_depreciation && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Recoverable</span>
                          <span className="text-primary">
                            ${header.recoverable_depreciation.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {header.deductible && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Deductible</span>
                          <span className="text-destructive">
                            -${header.deductible.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {header.tax_amount && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tax</span>
                          <span>
                            ${header.tax_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {header.overhead_amount && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Overhead</span>
                          <span>
                            ${header.overhead_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {header.profit_amount && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Profit</span>
                          <span>
                            ${header.profit_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="flex justify-between">
                      <span className="font-semibold">Net Claim Amount</span>
                      <span className="text-xl font-bold">
                        ${(header.total_net_claim || header.total_acv || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {header.price_list_name && (
                      <div className="text-xs text-muted-foreground pt-4 border-t">
                        <p>Price List: {header.price_list_name}</p>
                        {header.price_list_region && <p>Region: {header.price_list_region}</p>}
                        {header.price_list_effective_date && <p>Effective: {header.price_list_effective_date}</p>}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    Totals will appear after document processing completes
                  </p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
};

export default ScopeViewer;
