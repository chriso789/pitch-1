import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  Upload, 
  FileText, 
  X, 
  Loader2,
  CheckCircle,
  Package,
  Wrench,
  Receipt,
  ScanLine,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LineItem {
  description: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
  unit_of_measure?: string;
  sku?: string;
  brand?: string;
  color?: string;
  style?: string;
  material_category?: string;
}

interface InvoiceUploadCardProps {
  projectId?: string;
  pipelineEntryId?: string;
  changeOrderId?: string;
  invoiceType: 'material' | 'labor' | 'overhead';
  onSuccess?: (invoice: any) => void;
}

const OVERHEAD_CATEGORIES = [
  { value: 'permit', label: 'Permit Fees' },
  { value: 'dumpster', label: 'Dumpster Rental' },
  { value: 'porta_potty', label: 'Porta-Potty' },
  { value: 'crane', label: 'Crane/Equipment Rental' },
  { value: 'disposal', label: 'Disposal Fees' },
  { value: 'delivery', label: 'Delivery Charges' },
  { value: 'other', label: 'Other Overhead' },
];

const emptyInvoiceForm = {
  vendor_name: '',
  crew_name: '',
  overhead_category: '',
  invoice_number: '',
  invoice_date: '',
  invoice_amount: '',
  subtotal: '',
  tax_amount: '',
  document_url: '',
  document_name: '',
  notes: ''
};

export const InvoiceUploadCard: React.FC<InvoiceUploadCardProps> = ({
  projectId,
  pipelineEntryId,
  changeOrderId,
  invoiceType,
  onSuccess
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [lineItemsOpen, setLineItemsOpen] = useState(false);
  const [parsedTotals, setParsedTotals] = useState<{ subtotal?: number; tax?: number; total?: number }>({});
  const [formData, setFormData] = useState(emptyInvoiceForm);

  const updateLineItem = (idx: number, patch: Partial<LineItem>) => {
    setLineItems(prev => {
      const next = prev.map((item, itemIdx) => {
        if (itemIdx !== idx) return item;
        const merged = { ...item, ...patch };
        const qty = Number(merged.quantity || 0);
        const unitPrice = Number(merged.unit_price || 0);
        return {
          ...merged,
          line_total: qty > 0 && unitPrice > 0 ? Number((qty * unitPrice).toFixed(2)) : merged.line_total,
        };
      });

      const editedSubtotal = next.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
      if (editedSubtotal > 0) {
        const tax = Number(formData.tax_amount || parsedTotals.tax || 0);
        const total = Number((editedSubtotal + tax).toFixed(2));
        setParsedTotals(prevTotals => ({ ...prevTotals, subtotal: editedSubtotal, total }));
        setFormData(prevForm => ({
          ...prevForm,
          subtotal: editedSubtotal.toFixed(2),
          invoice_amount: total.toFixed(2),
          notes: formatLineItemsSummary(next),
        }));
      }

      return next;
    });
  };

  const resetImportFields = () => {
    setFormData(emptyInvoiceForm);
    setLineItems([]);
    setParsedTotals({});
    setScanSuccess(false);
    setLineItemsOpen(false);
  };

  useEffect(() => {
    const handleInvoiceDeleted = (event: CustomEvent) => {
      const detail = event.detail || {};
      if (detail.pipelineEntryId === pipelineEntryId && detail.invoiceType === invoiceType) {
        resetImportFields();
      }
    };

    window.addEventListener('invoice-deleted', handleInvoiceDeleted as EventListener);
    return () => window.removeEventListener('invoice-deleted', handleInvoiceDeleted as EventListener);
  }, [pipelineEntryId, invoiceType]);

  const formatLineItemsSummary = (items: LineItem[]): string => {
    if (!items.length) return '';
    const lines = items.map(item => {
      const parts = [item.description];
      if (item.quantity) parts.push(`Qty: ${item.quantity}`);
      if (item.line_total) parts.push(`$${item.line_total.toFixed(2)}`);
      return parts.join(' — ');
    });
    return lines.join('\n');
  };

  const parseInvoiceWithAI = async (documentUrl: string) => {
    setScanning(true);
    setScanSuccess(false);
    try {
      const { data, error } = await supabase.functions.invoke('parse-invoice-document', {
        body: { document_url: documentUrl }
      });

      if (error) {
        console.error('AI parse error:', error);
        return;
      }

      if (data?.parsed) {
        const parsed = data.parsed;
        const amount = parsed.total_amount || parsed.invoice_amount;
        const items: LineItem[] = parsed.line_items || [];
        
        setLineItems(items);
        setParsedTotals({
          subtotal: parsed.subtotal,
          tax: parsed.tax_amount,
          total: amount
        });
        if (items.length > 0) setLineItemsOpen(true);

        // Build notes from line items
        const itemsSummary = formatLineItemsSummary(items);

        setFormData(prev => ({
          ...prev,
          invoice_number: parsed.invoice_number || prev.invoice_number,
          invoice_date: parsed.invoice_date || prev.invoice_date,
          invoice_amount: amount ? String(amount) : prev.invoice_amount,
          subtotal: parsed.subtotal ? String(parsed.subtotal) : prev.subtotal,
          tax_amount: parsed.tax_amount ? String(parsed.tax_amount) : prev.tax_amount,
          vendor_name: parsed.vendor_name || prev.vendor_name,
          notes: itemsSummary || prev.notes,
        }));

        setScanSuccess(true);
        toast({
          title: 'Invoice Scanned Successfully',
          description: `Extracted ${items.length} line item${items.length !== 1 ? 's' : ''} — total $${amount ? Number(amount).toFixed(2) : '0.00'}. Verify and submit.`,
        });
      }
    } catch (err) {
      console.error('Invoice scan failed:', err);
    } finally {
      setScanning(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Storage RLS requires the first folder to be the user's tenant_id
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
        .maybeSingle();

      if (profileErr || !profile?.tenant_id) {
        throw new Error('Could not resolve your tenant — please re-login.');
      }

      const fileExt = file.name.split('.').pop();
      const folderId = projectId || pipelineEntryId || 'unknown';
      const fileName = `${profile.tenant_id}/${folderId}/${invoiceType}-${Date.now()}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('project-invoices')
        .upload(fileName, file);

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('project-invoices')
        .getPublicUrl(fileName);

      setFormData(prev => ({
        ...prev,
        document_url: urlData.publicUrl,
        document_name: file.name
      }));

      // For AI parsing we need a URL the edge function can actually fetch.
      // The bucket is private, so create a short-lived signed URL.
      const { data: signed, error: signErr } = await supabase.storage
        .from('project-invoices')
        .createSignedUrl(fileName, 60 * 10); // 10 minutes

      if (signErr || !signed?.signedUrl) {
        toast({
          title: 'File Uploaded',
          description: 'Could not auto-scan — please fill fields manually.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'File Uploaded',
        description: 'Scanning invoice with AI...'
      });

      // Trigger AI parsing using the signed URL
      parseInvoiceWithAI(signed.signedUrl);
    } catch (error: any) {
      toast({
        title: 'Upload Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.invoice_amount) {
      toast({
        title: 'Validation Error',
        description: 'Invoice amount is required',
        variant: 'destructive'
      });
      return;
    }

    if (!projectId && !pipelineEntryId) {
      toast({
        title: 'Validation Error',
        description: 'Project or pipeline entry is required',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const submit = async (allow_duplicate: boolean) => {
        return supabase.functions.invoke('submit-project-invoice', {
          body: {
            project_id: projectId || null,
            pipeline_entry_id: pipelineEntryId || null,
            change_order_id: changeOrderId || null,
            invoice_type: invoiceType,
            ...formData,
            invoice_amount: parseFloat(formData.invoice_amount),
            subtotal: formData.subtotal ? parseFloat(formData.subtotal) : null,
            tax_amount: formData.tax_amount ? parseFloat(formData.tax_amount) : null,
            line_items: lineItems,
            allow_duplicate,
          }
        });
      };

      let { data, error } = await submit(false);
      if (error) throw error;

      if (data?.duplicate) {
        const dup = data.duplicate_invoice;
        const reason = data.duplicate_reason ? `\nReason: ${data.duplicate_reason}` : '';
        const proceed = window.confirm(
          `Duplicate invoice detected from ${formData.vendor_name || 'this vendor'}` +
          (formData.invoice_number ? ` (#${formData.invoice_number})` : '') +
          `.${reason}\n\nExisting amount: $${dup?.invoice_amount ?? '?'} on ${dup?.invoice_date ?? 'unknown date'}.\n\nSave this one anyway?`
        );
        if (!proceed) {
          toast({ title: 'Duplicate skipped', description: 'Invoice was not saved.' });
          setLoading(false);
          return;
        }
        ({ data, error } = await submit(true));
        if (error) throw error;
      }

      const typeLabels = { material: 'Material', labor: 'Labor', overhead: 'Overhead' };
      toast({
        title: 'Invoice Submitted',
        description: `${typeLabels[invoiceType]} invoice recorded successfully${data?.invoice?.duplicate_of ? ' (flagged as duplicate)' : ''}`
      });

      resetImportFields();

      onSuccess?.(data.invoice);
    } catch (error: any) {
      toast({
        title: 'Submission Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const isMaterial = invoiceType === 'material';
  const isLabor = invoiceType === 'labor';
  const isOverhead = invoiceType === 'overhead';
  
  const Icon = isMaterial ? Package : isLabor ? Wrench : Receipt;
  const iconColor = isMaterial ? 'text-blue-500' : isLabor ? 'text-orange-500' : 'text-purple-500';
  const title = isMaterial ? 'Material Invoice' : isLabor ? 'Labor Invoice' : 'Other Charges';

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
          {scanning && (
            <Badge variant="secondary" className="ml-auto flex items-center gap-1 text-xs">
              <ScanLine className="h-3 w-3 animate-pulse" />
              Scanning invoice...
            </Badge>
          )}
          {scanSuccess && !scanning && (
            <Badge className="ml-auto flex items-center gap-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">
              <Sparkles className="h-3 w-3" />
              AI fields populated
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Upload */}
        <div>
          <Label>Invoice Document</Label>
          {formData.document_url ? (
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md mt-1">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm flex-1 truncate">{formData.document_name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  resetImportFields();
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="mt-1">
              <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-border rounded-md cursor-pointer hover:border-primary/50 transition-colors">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm text-muted-foreground">
                  {uploading ? 'Uploading...' : 'Upload PDF or Image — fields will auto-fill'}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileUpload}
                  disabled={uploading || scanning}
                />
              </label>
            </div>
          )}
        </div>

        {/* Extracted Line Items */}
        {lineItems.length > 0 && (
          <Collapsible open={lineItemsOpen} onOpenChange={setLineItemsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  {lineItems.length} extracted line item{lineItems.length !== 1 ? 's' : ''}
                </span>
                {lineItemsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-md border border-border overflow-hidden text-xs">
                <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_5.5rem_5.5rem] gap-1 bg-muted/50 px-2 py-1.5 font-medium text-muted-foreground">
                  <span>Description</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Unit $</span>
                  <span className="text-right">Total</span>
                </div>
                <div className="divide-y divide-border">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-[minmax(0,1fr)_4.25rem_5.5rem_5.5rem] gap-1 px-2 py-1.5 items-start">
                      <div className="min-w-0">
                        <Input
                          value={item.description}
                          onChange={(e) => updateLineItem(idx, { description: e.target.value })}
                          className="h-7 min-w-0 text-xs px-2"
                        />
                        {(item.brand || item.color || item.style || item.material_category) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.brand && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{item.brand}</Badge>}
                            {item.style && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{item.style}</Badge>}
                            {item.color && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/40 text-primary">{item.color}</Badge>}
                            {item.material_category && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">{item.material_category}</Badge>}
                          </div>
                        )}
                      </div>
                      <Input
                        type="number"
                        value={item.quantity ?? ''}
                        onChange={(e) => updateLineItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        className="h-7 text-xs text-right px-1.5"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unit_price ?? ''}
                        onChange={(e) => updateLineItem(idx, { unit_price: parseFloat(e.target.value) || 0 })}
                        className="h-7 text-xs text-right px-1.5"
                      />
                      <div className="h-7 flex items-center justify-end font-mono font-medium whitespace-nowrap">
                        {item.line_total != null ? `$${item.line_total.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  ))}
                </div>
                {(parsedTotals.subtotal != null || parsedTotals.tax != null || parsedTotals.total != null) && (
                  <div className="border-t border-border bg-muted/30 px-3 py-2 space-y-0.5">
                    {parsedTotals.subtotal != null && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Subtotal</span>
                        <span>${parsedTotals.subtotal.toFixed(2)}</span>
                      </div>
                    )}
                    {parsedTotals.tax != null && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Tax</span>
                        <span>${parsedTotals.tax.toFixed(2)}</span>
                      </div>
                    )}
                    {parsedTotals.total != null && (
                      <div className="flex justify-between text-xs font-semibold">
                        <span>Total</span>
                        <span>${parsedTotals.total.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="grid grid-cols-2 gap-3">
          {isMaterial && (
            <div className="col-span-2">
              <Label htmlFor="vendor_name">Vendor Name</Label>
              <Input
                id="vendor_name"
                placeholder="ABC Supply Co."
                value={formData.vendor_name}
                onChange={(e) => setFormData(prev => ({ ...prev, vendor_name: e.target.value }))}
              />
            </div>
          )}
          
          {isLabor && (
            <>
              <div className="col-span-2">
                <Label htmlFor="crew_name">Crew Name</Label>
                <Input
                  id="crew_name"
                  placeholder="Martinez Roofing Crew"
                  value={formData.crew_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, crew_name: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="vendor_name">Vendor / Company</Label>
                <Input
                  id="vendor_name"
                  placeholder="Vendor on invoice"
                  value={formData.vendor_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, vendor_name: e.target.value }))}
                />
              </div>
            </>
          )}
          
          {isOverhead && (
            <>
              <div className="col-span-2">
                <Label htmlFor="overhead_category">Cost Category *</Label>
                <Select
                  value={formData.overhead_category}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, overhead_category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {OVERHEAD_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="vendor_name">Vendor/Provider</Label>
                <Input
                  id="vendor_name"
                  placeholder="City of Austin Permits, Waste Management..."
                  value={formData.vendor_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, vendor_name: e.target.value }))}
                />
              </div>
            </>
          )}

          <div>
            <Label htmlFor="invoice_number">Invoice #</Label>
            <Input
              id="invoice_number"
              placeholder={scanning ? 'Scanning...' : 'INV-2025-001'}
              value={formData.invoice_number}
              onChange={(e) => setFormData(prev => ({ ...prev, invoice_number: e.target.value }))}
              disabled={scanning}
            />
          </div>

          <div>
            <Label htmlFor="invoice_date">Invoice Date</Label>
            <Input
              id="invoice_date"
              type="date"
              value={formData.invoice_date}
              onChange={(e) => setFormData(prev => ({ ...prev, invoice_date: e.target.value }))}
              disabled={scanning}
            />
          </div>

          <div>
            <Label htmlFor="subtotal">Subtotal</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="subtotal"
                type="number"
                step="0.01"
                placeholder={scanning ? 'Scanning...' : '0.00'}
                className="pl-7"
                value={formData.subtotal}
                onChange={(e) => setFormData(prev => ({ ...prev, subtotal: e.target.value }))}
                disabled={scanning}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="tax_amount">Tax</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="tax_amount"
                type="number"
                step="0.01"
                placeholder={scanning ? 'Scanning...' : '0.00'}
                className="pl-7"
                value={formData.tax_amount}
                onChange={(e) => setFormData(prev => ({ ...prev, tax_amount: e.target.value }))}
                disabled={scanning}
              />
            </div>
          </div>

          <div className="col-span-2">
            <Label htmlFor="invoice_amount">Total Amount *</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="invoice_amount"
                type="number"
                step="0.01"
                placeholder={scanning ? 'Scanning...' : '0.00'}
                className="pl-7"
                value={formData.invoice_amount}
                onChange={(e) => setFormData(prev => ({ ...prev, invoice_amount: e.target.value }))}
                disabled={scanning}
              />
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Notes (Optional)</Label>
          <Textarea
            id="notes"
            placeholder="Any additional notes..."
            rows={2}
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={loading || scanning || !formData.invoice_amount}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Submit Invoice
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
