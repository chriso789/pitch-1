import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useMaterialOrders } from '@/hooks/useMaterialOrders';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface MaterialOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId: string;
  onSuccess?: (orderId: string) => void;
}

export const MaterialOrderDialog: React.FC<MaterialOrderDialogProps> = ({
  open,
  onOpenChange,
  estimateId,
  onSuccess
}) => {
  const { createOrderFromEstimate, loading } = useMaterialOrders();
  const [vendors, setVendors] = useState<any[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [formData, setFormData] = useState({
    vendorId: '',
    branchCode: 'SRS-FL-CENTRAL',
    deliveryAddress: '',
    notes: ''
  });

  useEffect(() => {
    if (open) {
      fetchVendors();
    }
  }, [open]);

  const fetchVendors = async () => {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      setVendors(data || []);

      // Auto-select SRS if available
      const srsVendor = data?.find(v => 
        v.name.toLowerCase().includes('srs') || 
        v.name.toLowerCase().includes('suncoast')
      );
      if (srsVendor) {
        setFormData(prev => ({ ...prev, vendorId: srsVendor.id }));
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
      toast.error('Failed to load vendors');
    } finally {
      setLoadingVendors(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.vendorId) {
      toast.error('Please select a vendor');
      return;
    }

    try {
      const orderId = await createOrderFromEstimate(estimateId, formData.vendorId, {
        branchCode: formData.branchCode,
        deliveryAddress: formData.deliveryAddress ? JSON.parse(formData.deliveryAddress) : null,
        notes: formData.notes
      });

      onSuccess?.(orderId);
      onOpenChange(false);
      
      // Reset form
      setFormData({
        vendorId: '',
        branchCode: 'SRS-FL-CENTRAL',
        deliveryAddress: '',
        notes: ''
      });
    } catch (error) {
      // Error already handled in hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Material Order</DialogTitle>
          <DialogDescription>
            Generate a purchase order from this estimate's materials
          </DialogDescription>
        </DialogHeader>

        {loadingVendors ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor *</Label>
              <Select
                value={formData.vendorId}
                onValueChange={(value) => setFormData({ ...formData, vendorId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch">Branch Code</Label>
              <Input
                id="branch"
                value={formData.branchCode}
                onChange={(e) => setFormData({ ...formData, branchCode: e.target.value })}
                placeholder="SRS-FL-CENTRAL"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Delivery Address (JSON)</Label>
              <Textarea
                id="address"
                value={formData.deliveryAddress}
                onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                placeholder='{"street": "123 Main St", "city": "Orlando", "state": "FL", "zip": "32801"}'
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Special instructions or notes..."
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Order
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
