import React, { useState } from 'react';
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
  Receipt
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface InvoiceUploadCardProps {
  projectId?: string;
  pipelineEntryId?: string;
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

export const InvoiceUploadCard: React.FC<InvoiceUploadCardProps> = ({
  projectId,
  pipelineEntryId,
  invoiceType,
  onSuccess
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    vendor_name: '',
    crew_name: '',
    overhead_category: '',
    invoice_number: '',
    invoice_date: '',
    invoice_amount: '',
    document_url: '',
    document_name: '',
    notes: ''
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const folderId = projectId || pipelineEntryId || 'unknown';
      const fileName = `${folderId}/${invoiceType}-${Date.now()}.${fileExt}`;
      
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

      toast({
        title: 'File Uploaded',
        description: 'Invoice document uploaded successfully'
      });
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
      const { data, error } = await supabase.functions.invoke('submit-project-invoice', {
        body: {
          project_id: projectId || null,
          pipeline_entry_id: pipelineEntryId || null,
          invoice_type: invoiceType,
          ...formData,
          invoice_amount: parseFloat(formData.invoice_amount)
        }
      });

      if (error) throw error;

      const typeLabels = {
        material: 'Material',
        labor: 'Labor',
        overhead: 'Overhead'
      };
      toast({
        title: 'Invoice Submitted',
        description: `${typeLabels[invoiceType]} invoice recorded successfully`
      });

      // Reset form
      setFormData({
        vendor_name: '',
        crew_name: '',
        overhead_category: '',
        invoice_number: '',
        invoice_date: '',
        invoice_amount: '',
        document_url: '',
        document_name: '',
        notes: ''
      });

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
  const title = isMaterial ? 'Material Invoice' : isLabor ? 'Labor Invoice' : 'Overhead Cost';

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
            <div className="col-span-2">
              <Label htmlFor="crew_name">Crew Name</Label>
              <Input
                id="crew_name"
                placeholder="Martinez Roofing Crew"
                value={formData.crew_name}
                onChange={(e) => setFormData(prev => ({ ...prev, crew_name: e.target.value }))}
              />
            </div>
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
              placeholder="INV-2025-001"
              value={formData.invoice_number}
              onChange={(e) => setFormData(prev => ({ ...prev, invoice_number: e.target.value }))}
            />
          </div>

          <div>
            <Label htmlFor="invoice_date">Invoice Date</Label>
            <Input
              id="invoice_date"
              type="date"
              value={formData.invoice_date}
              onChange={(e) => setFormData(prev => ({ ...prev, invoice_date: e.target.value }))}
            />
          </div>

          <div className="col-span-2">
            <Label htmlFor="invoice_amount">Amount *</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="invoice_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                className="pl-7"
                value={formData.invoice_amount}
                onChange={(e) => setFormData(prev => ({ ...prev, invoice_amount: e.target.value }))}
              />
            </div>
          </div>
        </div>

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
                onClick={() => setFormData(prev => ({ ...prev, document_url: '', document_name: '' }))}
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
                  {uploading ? 'Uploading...' : 'Upload PDF or Image'}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          )}
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
          disabled={loading || !formData.invoice_amount}
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
