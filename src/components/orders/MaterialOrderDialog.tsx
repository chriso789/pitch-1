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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useMaterialOrders } from '@/hooks/useMaterialOrders';
import { useLivePricing } from '@/hooks/useLivePricing';
import { LivePricingStatus } from './LivePricingStatus';
import { Loader2, AlertCircle } from 'lucide-react';
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
  const { fetchLivePricing, applyLivePricing, refreshing } = useLivePricing();
  const [vendors, setVendors] = useState<any[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [estimateItems, setEstimateItems] = useState<any[]>([]);
  const [pricingData, setPricingData] = useState<any[]>([]);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [formData, setFormData] = useState({
    vendorId: '',
    branchCode: 'SRS-FL-CENTRAL',
    deliveryAddress: '',
    notes: ''
  });

  useEffect(() => {
    if (open) {
      fetchVendors();
      fetchEstimateItems();
    }
  }, [open]);

  useEffect(() => {
    if (formData.vendorId && estimateItems.length > 0) {
      handleRefreshPricing();
    }
  }, [formData.vendorId, estimateItems]);

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

  const fetchEstimateItems = async () => {
    try {
      const { data, error } = await supabase
        .from('estimate_line_items')
        .select('*')
        .eq('estimate_id', estimateId)
        .eq('item_category', 'material')
        .order('sort_order');

      if (error) throw error;

      const items = (data || []).map(item => ({
        sku: item.srs_item_code,
        item_description: item.description,
        color_specs: item.notes, // Include color/specs for supplier orders
        quantity: item.quantity,
        unit_price: item.unit_cost,
        last_price_updated: undefined // Will be fetched from pricing API
      }));

      setEstimateItems(items);
      setPricingData(items);
    } catch (error) {
      console.error('Error fetching estimate items:', error);
      toast.error('Failed to load estimate items');
    }
  };

  const handleRefreshPricing = async () => {
    if (estimateItems.length === 0) return;

    setLoadingPricing(true);
    try {
      const enrichedItems = await fetchLivePricing(
        estimateItems,
        formData.vendorId,
        formData.branchCode
      );
      setPricingData(enrichedItems);
      
      const hasSignificantChanges = enrichedItems.some(
        item => item.price_variance_pct && Math.abs(item.price_variance_pct) > 5
      );
      
      if (hasSignificantChanges) {
        toast.warning('Significant price changes detected. Review pricing before creating PO.');
      }
    } catch (error) {
      console.error('Error refreshing pricing:', error);
    } finally {
      setLoadingPricing(false);
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
            {/* Pricing Status */}
            {pricingData.length > 0 && (
              <LivePricingStatus
                items={pricingData}
                onRefreshPricing={handleRefreshPricing}
                refreshing={refreshing || loadingPricing}
              />
            )}

            {/* Warning for stale prices */}
            {pricingData.some(item => {
              if (!item.last_price_updated) return true;
              const priceAge = new Date().getTime() - new Date(item.last_price_updated).getTime();
              return priceAge > 24 * 60 * 60 * 1000;
            }) && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Some prices are over 24 hours old. Consider refreshing pricing before creating the PO to ensure accurate costs.
                </AlertDescription>
              </Alert>
            )}
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
