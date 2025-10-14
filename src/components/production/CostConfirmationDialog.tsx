import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Upload, DollarSign } from 'lucide-react';

interface CostConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

export const CostConfirmationDialog = ({ 
  open, 
  onOpenChange, 
  projectId,
  onSuccess 
}: CostConfirmationDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    kind: 'MATERIAL' as 'MATERIAL' | 'LABOR' | 'OTHER',
    amount: '',
    vendor_name: '',
    external_ref: '',
    note: '',
    doc_url: '',
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      const fileExt = file.name.split('.').pop();
      const fileName = `${projectId}/costs/${Date.now()}.${fileExt}`;
      
      const { error: uploadError, data } = await supabase.storage
        .from('documents')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('documents')
        .getPublicUrl(fileName);

      setFormData(prev => ({ ...prev, doc_url: publicUrl }));

      toast({
        title: "File Uploaded",
        description: "Invoice uploaded successfully",
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload invoice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid cost amount",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      const { error } = await supabase
        .from('job_cost_events')
        .insert({
          tenant_id: profile?.tenant_id,
          job_id: projectId,
          kind: formData.kind,
          amount: parseFloat(formData.amount),
          vendor_name: formData.vendor_name || null,
          external_ref: formData.external_ref || null,
          doc_url: formData.doc_url || null,
          note: formData.note || null,
        });

      if (error) throw error;

      toast({
        title: "Cost Confirmed",
        description: `${formData.kind.toLowerCase()} cost recorded. Cap-Out budget updated.`,
      });

      // Reset form
      setFormData({
        kind: 'MATERIAL',
        amount: '',
        vendor_name: '',
        external_ref: '',
        note: '',
        doc_url: '',
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error confirming cost:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to record cost confirmation",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Confirm Cost
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kind">Cost Type</Label>
            <Select
              value={formData.kind}
              onValueChange={(value: any) => setFormData(prev => ({ ...prev, kind: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MATERIAL">Material</SelectItem>
                <SelectItem value="LABOR">Labor</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={formData.amount}
              onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor Name</Label>
            <Input
              id="vendor"
              placeholder="e.g., Sunniland Supply"
              value={formData.vendor_name}
              onChange={(e) => setFormData(prev => ({ ...prev, vendor_name: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice">Invoice/PO Number</Label>
            <Input
              id="invoice"
              placeholder="e.g., INV-98731"
              value={formData.external_ref}
              onChange={(e) => setFormData(prev => ({ ...prev, external_ref: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="document">Upload Invoice (Optional)</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={uploading}
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {formData.doc_url ? 'Change File' : 'Upload File'}
                  </>
                )}
              </Button>
              {formData.doc_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(formData.doc_url, '_blank')}
                >
                  View
                </Button>
              )}
            </div>
            <input
              id="file-upload"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Notes</Label>
            <Textarea
              id="note"
              placeholder="Additional details..."
              value={formData.note}
              onChange={(e) => setFormData(prev => ({ ...prev, note: e.target.value }))}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || uploading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              'Confirm Cost'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};