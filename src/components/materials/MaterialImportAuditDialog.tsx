import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Upload, Package, TrendingUp, TrendingDown, Check, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import Papa from "papaparse";
import { ImportAuditTable } from "./ImportAuditTable";

interface Material {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  uom: string;
  coverage_per_unit: number | null;
  base_cost: number | null;
  default_markup_pct: number | null;
  supplier_sku: string | null;
}

interface ImportedItem {
  code: string;
  name: string;
  category: string;
  uom: string;
  newCost: number;
  supplierSku?: string;
  markupPct?: number;
  coverage?: number;
  description?: string;
}

export interface AuditItem extends ImportedItem {
  existingMaterial?: Material;
  currentCost: number | null;
  priceDiff: number | null;
  priceDiffPct: number | null;
  status: 'new' | 'increase' | 'decrease' | 'no_change';
  selected: boolean;
}

interface ImportAuditSummary {
  totalItems: number;
  newItems: AuditItem[];
  priceIncreases: AuditItem[];
  priceDecreases: AuditItem[];
  noChange: AuditItem[];
}

interface MaterialImportAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingMaterials: Material[];
  onImportComplete: () => void;
}

type Step = 'upload' | 'analyzing' | 'review' | 'saving';

export function MaterialImportAuditDialog({
  open,
  onOpenChange,
  existingMaterials,
  onImportComplete
}: MaterialImportAuditDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [auditSummary, setAuditSummary] = useState<ImportAuditSummary | null>(null);
  const [allItems, setAllItems] = useState<AuditItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetDialog = () => {
    setStep('upload');
    setAuditSummary(null);
    setAllItems([]);
    setActiveTab('all');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      resetDialog();
    }
    onOpenChange(isOpen);
  };

  const mapColumnName = (headers: string[], possibleNames: string[]): string | null => {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());
    for (const name of possibleNames) {
      const idx = lowerHeaders.indexOf(name.toLowerCase());
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  const parseCSVRow = (row: any, headers: string[]): ImportedItem | null => {
    // Expanded to support more vendor formats (SRS, ABC Supply, etc.)
    const codeCol = mapColumnName(headers, [
      'code', 'sku', 'item_code', 'item', 'item_number', 'part_number', 'product_code',
      'Code', 'SKU', 'Item Code', 'ItemCode', 'Item', 'Item Number', 'Part Number', 'Product Code'
    ]);
    const nameCol = mapColumnName(headers, [
      'name', 'description', 'product', 'item_name', 'item_description', 'material',
      'Name', 'Description', 'Product', 'ItemName', 'Item Name', 'Item Description', 'Material'
    ]);
    const costCol = mapColumnName(headers, [
      'cost', 'price', 'base_cost', 'unit_cost', 'unit_price',
      'cost_per_unit', 'cost per unit', 'cost per item', 'cost per bundle', 'cost per square',
      'Cost', 'Price', 'BaseCost', 'UnitCost', 'Unit Cost', 'Unit Price',
      'Cost Per Unit', 'Cost Per Item', 'Cost Per Bundle', 'Cost Per Square'
    ]);
    const uomCol = mapColumnName(headers, [
      'uom', 'unit', 'unit_of_measure', 'units',
      'UOM', 'Unit', 'Unit of Measure', 'Units'
    ]);
    const categoryCol = mapColumnName(headers, [
      'category', 'category_name', 'type', 'product_type', 'material_type',
      'Category', 'CategoryName', 'Type', 'Product Type', 'Material Type'
    ]);
    const markupCol = mapColumnName(headers, ['markup', 'markup_pct', 'Markup', 'MarkupPct']);
    const coverageCol = mapColumnName(headers, ['coverage', 'coverage_per_unit', 'Coverage']);
    const skuCol = mapColumnName(headers, ['supplier_sku', 'vendor_sku', 'SupplierSku', 'VendorSku']);
    const brandCol = mapColumnName(headers, [
      'brand', 'manufacturer', 'brand_name', 'brand logo',
      'Brand', 'Manufacturer', 'Brand Name', 'Brand Logo'
    ]);

    const code = codeCol ? row[codeCol]?.toString().trim() : null;
    const name = nameCol ? row[nameCol]?.toString().trim() : null;
    const costStr = costCol ? row[costCol]?.toString().replace(/[$,]/g, '').trim() : null;
    const cost = costStr ? parseFloat(costStr) : NaN;

    if (!code || !name || isNaN(cost) || cost <= 0) return null;

    return {
      code,
      name,
      newCost: cost,
      uom: uomCol ? row[uomCol]?.toString().trim() || 'EA' : 'EA',
      category: categoryCol ? row[categoryCol]?.toString().trim() || '' : '',
      markupPct: markupCol ? parseFloat(row[markupCol]) || 0.35 : 0.35,
      coverage: coverageCol ? parseFloat(row[coverageCol]) || undefined : undefined,
      supplierSku: skuCol ? row[skuCol]?.toString().trim() : undefined,
    };
  };

  const analyzeImport = (importedItems: ImportedItem[]): ImportAuditSummary => {
    const materialByCode = new Map(existingMaterials.map(m => [m.code.toLowerCase(), m]));
    const materialBySku = new Map(
      existingMaterials.filter(m => m.supplier_sku).map(m => [m.supplier_sku!.toLowerCase(), m])
    );

    const auditItems: AuditItem[] = importedItems.map(item => {
      const existing = materialByCode.get(item.code.toLowerCase())
        || materialBySku.get(item.code.toLowerCase())
        || (item.supplierSku ? materialBySku.get(item.supplierSku.toLowerCase()) : undefined);

      const currentCost = existing?.base_cost ?? null;
      const priceDiff = currentCost !== null ? Number((item.newCost - currentCost).toFixed(2)) : null;
      const priceDiffPct = currentCost && currentCost > 0 
        ? Number(((priceDiff! / currentCost) * 100).toFixed(1)) 
        : null;

      let status: AuditItem['status'];
      if (!existing) {
        status = 'new';
      } else if (priceDiff === 0 || priceDiff === null) {
        status = 'no_change';
      } else if (priceDiff > 0) {
        status = 'increase';
      } else {
        status = 'decrease';
      }

      return {
        ...item,
        existingMaterial: existing,
        currentCost,
        priceDiff,
        priceDiffPct,
        status,
        selected: status !== 'no_change'
      };
    });

    return {
      totalItems: auditItems.length,
      newItems: auditItems.filter(i => i.status === 'new'),
      priceIncreases: auditItems.filter(i => i.status === 'increase'),
      priceDecreases: auditItems.filter(i => i.status === 'decrease'),
      noChange: auditItems.filter(i => i.status === 'no_change')
    };
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStep('analyzing');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const headers = results.meta.fields || [];
          const importedItems: ImportedItem[] = results.data
            .map((row: any) => parseCSVRow(row, headers))
            .filter((item): item is ImportedItem => item !== null);

          if (importedItems.length === 0) {
            toast.error('No valid rows found in CSV. Check column names and data.');
            setStep('upload');
            return;
          }

          const summary = analyzeImport(importedItems);
          setAuditSummary(summary);
          setAllItems([
            ...summary.newItems,
            ...summary.priceIncreases,
            ...summary.priceDecreases,
            ...summary.noChange
          ]);
          setStep('review');
        } catch (error: any) {
          console.error('Parse error:', error);
          toast.error('Failed to parse CSV: ' + error.message);
          setStep('upload');
        }
      },
      error: (error) => {
        toast.error('Failed to read CSV: ' + error.message);
        setStep('upload');
      }
    });
  };

  const toggleItemSelection = (code: string) => {
    setAllItems(prev => prev.map(item => 
      item.code === code ? { ...item, selected: !item.selected } : item
    ));
  };

  const selectAll = (status: AuditItem['status'] | 'all') => {
    setAllItems(prev => prev.map(item => ({
      ...item,
      selected: status === 'all' || item.status === status ? true : item.selected
    })));
  };

  const deselectAll = (status: AuditItem['status'] | 'all') => {
    setAllItems(prev => prev.map(item => ({
      ...item,
      selected: status === 'all' || item.status === status ? false : item.selected
    })));
  };

  const handleSave = async () => {
    const selectedItems = allItems.filter(i => i.selected);
    if (selectedItems.length === 0) {
      toast.error('No items selected');
      return;
    }

    setSaving(true);
    setStep('saving');

    try {
      const importData = selectedItems.map(item => ({
        code: item.code,
        name: item.name,
        description: item.description || null,
        category: item.category || null,
        uom: item.uom,
        base_cost: item.newCost,
        markup_pct: item.markupPct || 0.35,
        coverage: item.coverage || null,
        sku: item.supplierSku || null
      }));

      const { data, error } = await supabase.rpc('api_bulk_import_materials' as any, {
        p_materials: importData
      });

      if (error) throw error;

      // Log price changes to price_history (optional - skip if vendor_code is required)
      // Note: price_history table requires vendor_code, so we'll skip logging for now
      // unless we add vendor tracking to the import process
      
      const added = selectedItems.filter(i => i.status === 'new').length;
      const updated = selectedItems.filter(i => i.status !== 'new' && i.status !== 'no_change').length;
      
      toast.success(`Added ${added} new materials, updated ${updated} prices`);
      onImportComplete();
      handleClose(false);
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error('Failed to import: ' + error.message);
      setStep('review');
    } finally {
      setSaving(false);
    }
  };

  const getFilteredItems = (): AuditItem[] => {
    switch (activeTab) {
      case 'new': return allItems.filter(i => i.status === 'new');
      case 'increase': return allItems.filter(i => i.status === 'increase');
      case 'decrease': return allItems.filter(i => i.status === 'decrease');
      case 'nochange': return allItems.filter(i => i.status === 'no_change');
      default: return allItems;
    }
  };

  const selectedCount = allItems.filter(i => i.selected).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import Materials from CSV
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV file with materials. The system will compare against existing items 
              and show you any pricing differences before importing.
            </p>
            
            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-file-input"
              />
              <label htmlFor="csv-file-input" className="cursor-pointer">
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="font-medium">Click to upload CSV file</p>
                <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
              </label>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 text-sm">
              <p className="font-medium mb-2">Supported column names:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground text-xs">
                <p><strong>Code:</strong> code, sku, item, item_code, product_code</p>
                <p><strong>Name:</strong> name, description, product, material</p>
                <p><strong>Cost:</strong> cost, price, unit_cost, cost per item, cost per bundle</p>
                <p><strong>UOM:</strong> uom, unit (defaults to EA)</p>
                <p><strong>Category:</strong> category, type</p>
                <p><strong>Brand:</strong> brand, manufacturer, brand logo</p>
              </div>
            </div>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="py-12 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Analyzing CSV and comparing with existing materials...</p>
            <Progress value={50} className="max-w-xs mx-auto" />
          </div>
        )}

        {step === 'review' && auditSummary && (
          <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
              <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-xl font-bold text-green-700 dark:text-green-400">
                        {auditSummary.newItems.length}
                      </p>
                      <p className="text-xs text-green-600">New Items</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-600" />
                    <div>
                      <p className="text-xl font-bold text-orange-700 dark:text-orange-400">
                        {auditSummary.priceIncreases.length}
                      </p>
                      <p className="text-xs text-orange-600">Price Increases</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
                        {auditSummary.priceDecreases.length}
                      </p>
                      <p className="text-xs text-blue-600">Price Decreases</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-xl font-bold text-gray-600 dark:text-gray-400">
                        {auditSummary.noChange.length}
                      </p>
                      <p className="text-xs text-gray-500">No Change</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabs and Table */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="all">All ({auditSummary.totalItems})</TabsTrigger>
                  <TabsTrigger value="new">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      New ({auditSummary.newItems.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="increase">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      Increases ({auditSummary.priceIncreases.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="decrease">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      Decreases ({auditSummary.priceDecreases.length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="nochange">No Change ({auditSummary.noChange.length})</TabsTrigger>
                </TabsList>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectAll(activeTab === 'all' ? 'all' : activeTab as AuditItem['status'])}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deselectAll(activeTab === 'all' ? 'all' : activeTab as AuditItem['status'])}
                  >
                    Deselect All
                  </Button>
                </div>
              </div>

              <TabsContent value={activeTab} className="flex-1 overflow-auto mt-2">
                <ImportAuditTable
                  items={getFilteredItems()}
                  onToggleSelection={toggleItemSelection}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {step === 'saving' && (
          <div className="py-12 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Saving materials to catalog...</p>
            <Progress value={75} className="max-w-xs mx-auto" />
          </div>
        )}

        <DialogFooter className="border-t pt-4">
          {step === 'review' && (
            <>
              <div className="flex-1 text-sm text-muted-foreground">
                {selectedCount} items selected for import
              </div>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={selectedCount === 0}>
                Save Selected to Catalog
              </Button>
            </>
          )}
          {(step === 'upload' || step === 'analyzing') && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
