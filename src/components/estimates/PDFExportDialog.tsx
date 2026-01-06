// PDF Export Dialog with component filter toggles
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Download, 
  Eye, 
  Building2, 
  User, 
  List, 
  DollarSign, 
  FileSignature,
  Loader2,
  AlertTriangle,
  Ruler,
  Image,
  Shield
} from 'lucide-react';
import { 
  type PDFComponentOptions, 
  type PDFViewMode, 
  PDF_PRESETS, 
  getDefaultOptions 
} from './PDFComponentOptions';

interface PDFExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (options: PDFComponentOptions) => Promise<void>;
  isExporting?: boolean;
  finePrintAvailable?: boolean;
  finePrintContent?: string;
}

export function PDFExportDialog({
  open,
  onOpenChange,
  onExport,
  isExporting = false,
  finePrintAvailable = false,
  finePrintContent,
}: PDFExportDialogProps) {
  const [viewMode, setViewMode] = useState<PDFViewMode>('customer');
  const [options, setOptions] = useState<PDFComponentOptions>(getDefaultOptions('customer'));

  const handleViewModeChange = (mode: PDFViewMode) => {
    setViewMode(mode);
    setOptions(getDefaultOptions(mode));
  };

  const updateOption = (key: keyof PDFComponentOptions, value: boolean) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const handleExport = async () => {
    await onExport(options);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Export Estimate PDF
          </DialogTitle>
          <DialogDescription>
            Choose what to include in your PDF. Customer mode hides internal pricing details.
          </DialogDescription>
        </DialogHeader>

        {/* View Mode Tabs */}
        <Tabs value={viewMode} onValueChange={(v) => handleViewModeChange(v as PDFViewMode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="customer" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer View
            </TabsTrigger>
            <TabsTrigger value="internal" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Internal View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="customer" className="mt-4">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm">
              <Eye className="h-4 w-4 text-green-600" />
              <span className="text-green-700 dark:text-green-400">
                Customer-safe: Profit margins and commission are hidden
              </span>
            </div>
          </TabsContent>

          <TabsContent value="internal" className="mt-4">
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-amber-700 dark:text-amber-400">
                Internal only: Contains profit margins and commission details
              </span>
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        {/* Component Toggles */}
        <div className="space-y-6">
          {/* Company & Customer Info */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4" />
              Header Information
            </h4>
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div className="flex items-center justify-between">
                <Label htmlFor="showCompanyLogo" className="text-sm">Company Logo</Label>
                <Switch
                  id="showCompanyLogo"
                  checked={options.showCompanyLogo}
                  onCheckedChange={(v) => updateOption('showCompanyLogo', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showCompanyInfo" className="text-sm">Company Contact</Label>
                <Switch
                  id="showCompanyInfo"
                  checked={options.showCompanyInfo}
                  onCheckedChange={(v) => updateOption('showCompanyInfo', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showCustomerName" className="text-sm">Customer Name</Label>
                <Switch
                  id="showCustomerName"
                  checked={options.showCustomerName}
                  onCheckedChange={(v) => updateOption('showCustomerName', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showCustomerAddress" className="text-sm">Property Address</Label>
                <Switch
                  id="showCustomerAddress"
                  checked={options.showCustomerAddress}
                  onCheckedChange={(v) => updateOption('showCustomerAddress', v)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <List className="h-4 w-4" />
              Line Items
            </h4>
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div className="flex items-center justify-between">
                <Label htmlFor="showMaterialsSection" className="text-sm">Materials Section</Label>
                <Switch
                  id="showMaterialsSection"
                  checked={options.showMaterialsSection}
                  onCheckedChange={(v) => updateOption('showMaterialsSection', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showLaborSection" className="text-sm">Labor Section</Label>
                <Switch
                  id="showLaborSection"
                  checked={options.showLaborSection}
                  onCheckedChange={(v) => updateOption('showLaborSection', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showLineItemQuantities" className="text-sm">Show Quantities</Label>
                <Switch
                  id="showLineItemQuantities"
                  checked={options.showLineItemQuantities}
                  onCheckedChange={(v) => updateOption('showLineItemQuantities', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showLineItemPricing" className="text-sm">Show Unit Pricing</Label>
                <Switch
                  id="showLineItemPricing"
                  checked={options.showLineItemPricing}
                  onCheckedChange={(v) => updateOption('showLineItemPricing', v)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Pricing Summary */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4" />
              Pricing Display
            </h4>
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div className="flex items-center justify-between">
                <Label htmlFor="showSubtotals" className="text-sm">Section Subtotals</Label>
                <Switch
                  id="showSubtotals"
                  checked={options.showSubtotals}
                  onCheckedChange={(v) => updateOption('showSubtotals', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showOnlyTotal" className="text-sm">Show Only Total</Label>
                <Switch
                  id="showOnlyTotal"
                  checked={options.showOnlyTotal}
                  onCheckedChange={(v) => updateOption('showOnlyTotal', v)}
                />
              </div>
              {viewMode === 'internal' && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showCostBreakdown" className="text-sm">
                      Cost Breakdown
                      <Badge variant="outline" className="ml-2 text-xs">Internal</Badge>
                    </Label>
                    <Switch
                      id="showCostBreakdown"
                      checked={options.showCostBreakdown}
                      onCheckedChange={(v) => updateOption('showCostBreakdown', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showProfitInfo" className="text-sm">
                      Profit Margin
                      <Badge variant="outline" className="ml-2 text-xs">Internal</Badge>
                    </Label>
                    <Switch
                      id="showProfitInfo"
                      checked={options.showProfitInfo}
                      onCheckedChange={(v) => updateOption('showProfitInfo', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showRepCommission" className="text-sm">
                      Rep Commission
                      <Badge variant="outline" className="ml-2 text-xs">Internal</Badge>
                    </Label>
                    <Switch
                      id="showRepCommission"
                      checked={options.showRepCommission}
                      onCheckedChange={(v) => updateOption('showRepCommission', v)}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Extra Pages */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Ruler className="h-4 w-4" />
              Extra Pages
            </h4>
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div className="flex items-center justify-between">
                <Label htmlFor="showMeasurementDetails" className="text-sm">Measurement Details</Label>
                <Switch
                  id="showMeasurementDetails"
                  checked={options.showMeasurementDetails}
                  onCheckedChange={(v) => updateOption('showMeasurementDetails', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showJobPhotos" className="text-sm">Job Photos</Label>
                <Switch
                  id="showJobPhotos"
                  checked={options.showJobPhotos}
                  onCheckedChange={(v) => updateOption('showJobPhotos', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showWarrantyInfo" className="text-sm">Warranty Info</Label>
                <Switch
                  id="showWarrantyInfo"
                  checked={options.showWarrantyInfo}
                  onCheckedChange={(v) => updateOption('showWarrantyInfo', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showPageHeader" className="text-sm">Page Header</Label>
                <Switch
                  id="showPageHeader"
                  checked={options.showPageHeader}
                  onCheckedChange={(v) => updateOption('showPageHeader', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showPageFooter" className="text-sm">Page Footer</Label>
                <Switch
                  id="showPageFooter"
                  checked={options.showPageFooter}
                  onCheckedChange={(v) => updateOption('showPageFooter', v)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Terms & Signature */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <FileSignature className="h-4 w-4" />
              Terms & Signature
            </h4>
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div className="flex items-center justify-between">
                <Label htmlFor="showTermsAndConditions" className="text-sm">Terms & Conditions</Label>
                <Switch
                  id="showTermsAndConditions"
                  checked={options.showTermsAndConditions}
                  onCheckedChange={(v) => updateOption('showTermsAndConditions', v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="showSignatureBlock" className="text-sm">Signature Block</Label>
                <Switch
                  id="showSignatureBlock"
                  checked={options.showSignatureBlock}
                  onCheckedChange={(v) => updateOption('showSignatureBlock', v)}
                />
              </div>
              {finePrintAvailable && (
                <div className="flex items-center justify-between col-span-2">
                  <Label htmlFor="showCustomFinePrint" className="text-sm">
                    Include Contract Fine Print
                    {finePrintContent && (
                      <span className="text-muted-foreground ml-2">
                        ({finePrintContent.length > 50 ? finePrintContent.substring(0, 50) + '...' : finePrintContent})
                      </span>
                    )}
                  </Label>
                  <Switch
                    id="showCustomFinePrint"
                    checked={options.showCustomFinePrint}
                    onCheckedChange={(v) => updateOption('showCustomFinePrint', v)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
