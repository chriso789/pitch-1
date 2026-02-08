// Estimate Preview Panel with live toggle controls
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Building2,
  User,
  List,
  DollarSign,
  FileSignature,
  Download,
  Loader2,
  Eye,
  AlertTriangle,
  Image,
  Ruler,
  RotateCcw,
  FileText,
  Paperclip,
  ChevronDown,
  Layers,
  Share2,
} from 'lucide-react';
import {
  type PDFComponentOptions,
  type PDFViewMode,
  getDefaultOptions,
} from './PDFComponentOptions';
import { EstimatePDFDocument } from './EstimatePDFDocument';
import { EstimateAttachmentsManager, type TemplateAttachment } from './EstimateAttachmentsManager';
import { PageOrderManager, DEFAULT_PAGE_ORDER, type PageOrderItem } from './PageOrderManager';
import { type LineItem } from '@/hooks/useEstimatePricing';
import { useMultiPagePDFGeneration } from '@/hooks/useMultiPagePDFGeneration';
import { useToast } from '@/hooks/use-toast';
import { ShareEstimateDialog } from './ShareEstimateDialog';

interface CompanyInfo {
  name: string;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
}

interface MeasurementSummary {
  totalSquares: number;
  totalSqFt: number;
  eaveLength: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  rakeLength: number;
  wastePercent: number;
}

interface EstimatePreviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateNumber: string;
  estimateDisplayName?: string;
  templateName?: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  companyInfo?: CompanyInfo | null;
  materialItems: LineItem[];
  laborItems: LineItem[];
  breakdown: {
    materialsTotal: number;
    laborTotal: number;
    directCost: number;
    overheadAmount: number;
    totalCost: number;
    profitAmount: number;
    repCommissionAmount: number;
    sellingPrice: number;
    actualProfitMargin: number;
    salesTaxAmount?: number;
    totalWithTax?: number;
  };
  config: {
    overheadPercent: number;
    profitMarginPercent: number;
    repCommissionPercent: number;
    salesTaxEnabled?: boolean;
    salesTaxRate?: number;
  };
  finePrintContent?: string;
  measurementSummary?: MeasurementSummary | null;
  templateAttachments?: TemplateAttachment[];
  // Callbacks for managing attachments
  onAttachmentsChange?: (attachments: TemplateAttachment[]) => void;
  // Share functionality props
  estimateId?: string;
  pipelineEntryId?: string;
  contactId?: string;
}

export function EstimatePreviewPanel({
  open,
  onOpenChange,
  estimateNumber,
  estimateDisplayName,
  templateName,
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  companyInfo,
  materialItems,
  laborItems,
  breakdown,
  config,
  finePrintContent,
  measurementSummary,
  templateAttachments = [],
  onAttachmentsChange,
  estimateId,
  pipelineEntryId,
  contactId,
}: EstimatePreviewPanelProps) {
  const [viewMode, setViewMode] = useState<PDFViewMode>('customer');
  const [options, setOptions] = useState<PDFComponentOptions>(getDefaultOptions('customer'));
  const [isExporting, setIsExporting] = useState(false);
  const [additionalAttachments, setAdditionalAttachments] = useState<TemplateAttachment[]>([]);
  const [removedTemplateIds, setRemovedTemplateIds] = useState<Set<string>>(new Set());
  const [pageOrder, setPageOrder] = useState<PageOrderItem[]>(DEFAULT_PAGE_ORDER);
  const [isPageOrderOpen, setIsPageOrderOpen] = useState(false);
  const [isAttachmentsOpen, setIsAttachmentsOpen] = useState(true);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const { generateMultiPagePDF, isGenerating: isGeneratingPDF } = useMultiPagePDFGeneration();
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);

  // Filter template attachments to exclude removed ones
  const activeTemplateAttachments = useMemo(() => 
    templateAttachments.filter(a => !removedTemplateIds.has(a.document_id)),
    [templateAttachments, removedTemplateIds]
  );

  // Combine active template attachments with additional ones (memoized to prevent re-renders)
  const allAttachments = useMemo(
    () => [...activeTemplateAttachments, ...additionalAttachments],
    [activeTemplateAttachments, additionalAttachments]
  );

  // Handlers for attachment management
  const handleAddAttachment = useCallback((attachment: TemplateAttachment) => {
    setAdditionalAttachments(prev => [...prev, attachment]);
  }, []);

  const handleRemoveAttachment = useCallback((documentId: string) => {
    // Check if it's a template attachment
    const isTemplateAttachment = templateAttachments.some(a => a.document_id === documentId);
    if (isTemplateAttachment) {
      // Track as removed (don't delete from DB, just hide in this session)
      setRemovedTemplateIds(prev => new Set([...prev, documentId]));
      toast({
        title: 'Attachment Removed',
        description: 'Template attachment hidden from this estimate',
      });
    } else {
      // Remove additional attachment normally
      setAdditionalAttachments(prev => prev.filter(a => a.document_id !== documentId));
    }
  }, [templateAttachments, toast]);

  const handleReorderAttachments = useCallback((reordered: TemplateAttachment[]) => {
    // Split back into template and additional
    const newAdditionalOrder = reordered.filter(a => !a.isFromTemplate);
    setAdditionalAttachments(newAdditionalOrder);
    // Could notify parent of reorder if needed: onAttachmentsChange?.(reordered);
  }, []);

  const handleViewModeChange = (mode: PDFViewMode) => {
    setViewMode(mode);
    setOptions(getDefaultOptions(mode));
  };

  const updateOption = (key: keyof PDFComponentOptions, value: boolean) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const handleResetToDefaults = () => {
    setOptions(getDefaultOptions(viewMode));
    // Also restore removed template attachments
    setRemovedTemplateIds(new Set());
  };

  // Generate safe filename from display name, template name, or estimate number
  const getFilename = useCallback(() => {
    // Priority: user-set display name > template name > estimate number
    const displaySource = estimateDisplayName?.trim() || templateName?.trim();
    
    if (displaySource) {
      // Sanitize: remove special chars, limit length
      const sanitized = displaySource
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 50);
      return `${sanitized}.pdf`;
    }
    return `${estimateNumber}.pdf`;
  }, [estimateDisplayName, templateName, estimateNumber]);

  const handleExportPDF = async () => {
    setIsExporting(true);
    const filename = getFilename();
    
    try {
      // Wait for any attachments to finish rendering
      const container = document.getElementById('estimate-preview-template');
      if (!container) throw new Error('Preview template not found');
      
      // Poll for attachment loading completion (max 10 seconds)
      const maxWaitMs = 10000;
      const pollIntervalMs = 200;
      let waited = 0;
      
      while (waited < maxWaitMs) {
        const loadingIndicators = container.querySelectorAll('.animate-spin');
        const pageCount = container.querySelectorAll('[data-report-page]').length;
        
        if (loadingIndicators.length === 0 && pageCount > 0) {
          console.log(`[PreviewExport] Ready after ${waited}ms, ${pageCount} pages found`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
      }
      
      // Small delay for final render stability (reduced for performance)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Count actual pages
      const pageCount = container.querySelectorAll('[data-report-page]').length;
      console.log(`[PreviewExport] Generating PDF with ${pageCount} pages`);
      
      // Generate multi-page PDF (captures each [data-report-page] separately)
      const result = await generateMultiPagePDF('estimate-preview-template', pageCount, {
        filename,
        format: 'letter',
        orientation: 'portrait',
      });

      if (result.success && result.blob) {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        toast({
          title: 'PDF Downloaded',
          description: `${filename} has been downloaded (${pageCount} pages)`,
        });
      } else {
        throw new Error(result.error || 'PDF generation failed');
      }
    } catch (error: any) {
      console.error('Error exporting PDF:', error);
      toast({
        title: 'Export Failed',
        description: error.message || 'Failed to generate PDF',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[95vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Preview Estimate
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[calc(95vh-120px)] min-h-0">
          {/* Left Panel - Toggle Controls */}
          <div className="w-80 shrink-0 border-r flex flex-col bg-muted/30 overflow-hidden min-h-0">
            <ScrollArea className="flex-1 w-full min-h-0">
              <div className="box-border w-full p-4 pr-10 pb-32 space-y-4">
              {/* View Mode Tabs */}
              <Tabs value={viewMode} onValueChange={(v) => handleViewModeChange(v as PDFViewMode)} className="mb-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="customer" className="text-xs">
                    <User className="h-3 w-3 mr-1" />
                    Customer
                  </TabsTrigger>
                  <TabsTrigger value="internal" className="text-xs">
                    <Building2 className="h-3 w-3 mr-1" />
                    Internal
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="customer" className="mt-2">
                  <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded text-xs">
                    <Eye className="h-3 w-3 text-green-600 shrink-0" />
                    <span className="text-green-700 dark:text-green-400">
                      Customer-safe view
                    </span>
                  </div>
                </TabsContent>

                <TabsContent value="internal" className="mt-2">
                  <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
                    <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                    <span className="text-amber-700 dark:text-amber-400">
                      Contains internal data
                    </span>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Toggle Sections */}
              <div className="space-y-4">
                {/* Header Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <Building2 className="h-3 w-3" />
                    Header
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Company Logo"
                      checked={options.showCompanyLogo}
                      onChange={(v) => updateOption('showCompanyLogo', v)}
                    />
                    <ToggleRow
                      label="Company Info"
                      checked={options.showCompanyInfo}
                      onChange={(v) => updateOption('showCompanyInfo', v)}
                    />
                    <ToggleRow
                      label="Page Header"
                      checked={options.showPageHeader}
                      onChange={(v) => updateOption('showPageHeader', v)}
                    />
                    <ToggleRow
                      label="Page Footer"
                      checked={options.showPageFooter}
                      onChange={(v) => updateOption('showPageFooter', v)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Customer Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <User className="h-3 w-3" />
                    Customer
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Customer Name"
                      checked={options.showCustomerName}
                      onChange={(v) => updateOption('showCustomerName', v)}
                    />
                    <ToggleRow
                      label="Property Address"
                      checked={options.showCustomerAddress}
                      onChange={(v) => updateOption('showCustomerAddress', v)}
                    />
                    <ToggleRow
                      label="Phone/Email"
                      checked={options.showCustomerContact}
                      onChange={(v) => updateOption('showCustomerContact', v)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Content Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <List className="h-3 w-3" />
                    Content
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Materials Section"
                      checked={options.showMaterialsSection}
                      onChange={(v) => updateOption('showMaterialsSection', v)}
                    />
                    <ToggleRow
                      label="Labor Section"
                      checked={options.showLaborSection}
                      onChange={(v) => updateOption('showLaborSection', v)}
                    />
                    <ToggleRow
                      label="Show Quantities"
                      checked={options.showLineItemQuantities}
                      onChange={(v) => updateOption('showLineItemQuantities', v)}
                    />
                    <ToggleRow
                      label="Unit Pricing"
                      checked={options.showLineItemPricing}
                      onChange={(v) => updateOption('showLineItemPricing', v)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Pricing Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <DollarSign className="h-3 w-3" />
                    Pricing
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Subtotals"
                      checked={options.showSubtotals}
                      onChange={(v) => updateOption('showSubtotals', v)}
                    />
                    <ToggleRow
                      label="Show Only Total"
                      checked={options.showOnlyTotal}
                      onChange={(v) => updateOption('showOnlyTotal', v)}
                    />
                    {viewMode === 'internal' && (
                      <>
                        <ToggleRow
                          label="Cost Breakdown"
                          checked={options.showCostBreakdown}
                          onChange={(v) => updateOption('showCostBreakdown', v)}
                          badge="Internal"
                        />
                        <ToggleRow
                          label="Profit Margin"
                          checked={options.showProfitInfo}
                          onChange={(v) => updateOption('showProfitInfo', v)}
                          badge="Internal"
                        />
                        <ToggleRow
                          label="Rep Commission"
                          checked={options.showRepCommission}
                          onChange={(v) => updateOption('showRepCommission', v)}
                          badge="Internal"
                        />
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Extra Pages Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <FileText className="h-3 w-3" />
                    Extra Pages
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Cover Page"
                      checked={options.showCoverPage}
                      onChange={(v) => updateOption('showCoverPage', v)}
                    />
                    <ToggleRow
                      label="Measurement Details"
                      checked={options.showMeasurementDetails}
                      onChange={(v) => updateOption('showMeasurementDetails', v)}
                      disabled={!measurementSummary}
                    />
                    <ToggleRow
                      label="Job Photos"
                      checked={options.showJobPhotos}
                      onChange={(v) => updateOption('showJobPhotos', v)}
                    />
                    <ToggleRow
                      label="Warranty Info"
                      checked={options.showWarrantyInfo}
                      onChange={(v) => updateOption('showWarrantyInfo', v)}
                    />
                  </div>
                </div>

                {/* Attachments Manager Section */}
                <Separator />
                <Collapsible open={isAttachmentsOpen} onOpenChange={setIsAttachmentsOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full py-1 hover:bg-muted/50 rounded -mx-1 px-1">
                    <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                      <Paperclip className="h-3 w-3" />
                      Attachments ({allAttachments.length})
                    </h4>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isAttachmentsOpen ? '' : '-rotate-90'}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <EstimateAttachmentsManager
                      templateAttachments={activeTemplateAttachments}
                      additionalAttachments={additionalAttachments}
                      onAddAttachment={handleAddAttachment}
                      onRemoveAttachment={handleRemoveAttachment}
                      onReorderAttachments={handleReorderAttachments}
                    />
                  </CollapsibleContent>
                </Collapsible>

                {/* Page Order Manager Section */}
                <Separator />
                <Collapsible open={isPageOrderOpen} onOpenChange={setIsPageOrderOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full py-1 hover:bg-muted/50 rounded -mx-1 px-1">
                    <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                      <Layers className="h-3 w-3" />
                      Page Order
                    </h4>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isPageOrderOpen ? '' : '-rotate-90'}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <PageOrderManager
                      pageOrder={pageOrder}
                      onPageOrderChange={setPageOrder}
                      hasAttachments={allAttachments.length > 0}
                      hasMeasurements={!!measurementSummary}
                      hasPhotos={false}
                    />
                  </CollapsibleContent>
                </Collapsible>

                <Separator />

                {/* Terms Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <FileSignature className="h-3 w-3" />
                    Terms
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Terms & Conditions"
                      checked={options.showTermsAndConditions}
                      onChange={(v) => updateOption('showTermsAndConditions', v)}
                    />
                    <ToggleRow
                      label="Custom Fine Print"
                      checked={options.showCustomFinePrint}
                      onChange={(v) => updateOption('showCustomFinePrint', v)}
                      disabled={!finePrintContent}
                    />
                    <ToggleRow
                      label="Signature Block"
                      checked={options.showSignatureBlock}
                      onChange={(v) => updateOption('showSignatureBlock', v)}
                    />
                  </div>
                </div>
              </div>
              </div>
            </ScrollArea>

            {/* Bottom Actions */}
            <div className="sticky bottom-0 z-20 shrink-0 border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2 relative pointer-events-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetToDefaults}
                className="w-full"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Defaults
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowShareDialog(true)}
                  disabled={!(estimateId || pipelineEntryId)}
                  className="flex-1"
                  title={!(estimateId || pipelineEntryId) ? 'Save the estimate first to share' : 'Share via email'}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
                <Button
                  onClick={handleExportPDF}
                  disabled={isExporting || isGeneratingPDF}
                  className="flex-1"
                >
                  {isExporting || isGeneratingPDF ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Export PDF
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Live Preview */}
          <div className="flex-1 bg-muted/50 overflow-auto p-6">
            <div className="flex justify-center">
              <div
                ref={previewRef}
                className="bg-white shadow-lg rounded-lg overflow-hidden"
                style={{ transform: 'scale(0.75)', transformOrigin: 'top center' }}
              >
                <div id="estimate-preview-template">
                  <EstimatePDFDocument
                    estimateNumber={estimateNumber}
                    estimateName={estimateDisplayName}
                    customerName={customerName}
                    customerAddress={customerAddress}
                    customerPhone={customerPhone}
                    customerEmail={customerEmail}
                    companyInfo={companyInfo || undefined}
                    companyName={companyInfo?.name || 'Company'}
                    companyLogo={companyInfo?.logo_url || undefined}
                    materialItems={materialItems}
                    laborItems={laborItems}
                    breakdown={breakdown}
                    config={config}
                    finePrintContent={options.showCustomFinePrint ? finePrintContent : undefined}
                    options={options}
                    measurementSummary={measurementSummary || undefined}
                    createdAt={new Date().toISOString()}
                    templateAttachments={allAttachments}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Share Estimate Dialog */}
      <ShareEstimateDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        estimateId={estimateId}
        pipelineEntryId={pipelineEntryId}
        contactId={contactId}
        customerEmail={customerEmail || ''}
        customerName={customerName}
        estimateNumber={estimateNumber}
      />
    </Dialog>
  );
}

// Toggle Row Component
function ToggleRow({
  label,
  checked,
  onChange,
  badge,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 w-full ${disabled ? 'opacity-50' : ''}`}>
      <Label className="text-sm flex items-center gap-1.5 cursor-pointer min-w-0 flex-1">
        <span className="truncate">{label}</span>
        {badge && (
          <Badge variant="outline" className="text-[10px] py-0 px-1 shrink-0">
            {badge}
          </Badge>
        )}
      </Label>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="shrink-0"
      />
    </div>
  );
}

export default EstimatePreviewPanel;
