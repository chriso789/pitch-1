import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Package, Trash2 } from 'lucide-react';
import { MaterialOrderDialog } from '@/components/orders/MaterialOrderDialog';
import { toast } from 'sonner';

interface EstimateLineItem {
  template_item_id: string;
  item_name: string;
  qty: number;
  unit_cost: number;
  line_total: number;
}

interface EstimateLineItemsProps {
  estimateId: string;
  className?: string;
  showOrderButton?: boolean;
  editable?: boolean;
  onItemDeleted?: () => void;
}

export const EstimateLineItems: React.FC<EstimateLineItemsProps> = ({
  estimateId,
  className = '',
  showOrderButton = false,
  editable = false,
  onItemDeleted
}) => {
  const [loading, setLoading] = useState(true);
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (estimateId) {
      fetchLineItems();
    }
  }, [estimateId]);

  const fetchLineItems = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .rpc('api_estimate_items_get', { p_estimate_id: estimateId });

      if (error) throw error;

      setLineItems(data || []);
    } catch (error) {
      console.error('Error fetching line items:', error);
      setError('Failed to load estimate line items');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (templateItemId: string) => {
    try {
      setDeletingId(templateItemId);
      
      // Get current estimate data
      const { data: estimate, error: fetchError } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items')
        .eq('id', estimateId)
        .single();

      if (fetchError) throw fetchError;

      const currentLineItems = (estimate?.line_items as Record<string, any[]>) || { materials: [], labor: [] };
      
      // Remove item from both sections
      const updatedLineItems = {
        materials: (currentLineItems.materials || []).filter((item: any) => item.id !== templateItemId && item.template_item_id !== templateItemId),
        labor: (currentLineItems.labor || []).filter((item: any) => item.id !== templateItemId && item.template_item_id !== templateItemId)
      };

      // Update estimate
      const { error: updateError } = await supabase
        .from('enhanced_estimates')
        .update({ line_items: updatedLineItems })
        .eq('id', estimateId);

      if (updateError) throw updateError;

      // Update local state
      setLineItems(prev => prev.filter(item => item.template_item_id !== templateItemId));
      toast.success('Line item deleted');
      onItemDeleted?.();
    } catch (err) {
      console.error('Error deleting line item:', err);
      toast.error('Failed to delete line item');
    } finally {
      setDeletingId(null);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Estimate Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading line items...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Estimate Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-destructive">
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (lineItems.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Estimate Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No line items calculated yet. Please ensure measurements and template are configured.
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalAmount = lineItems.reduce((sum, item) => sum + item.line_total, 0);

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Estimate Line Items</CardTitle>
            {showOrderButton && lineItems.length > 0 && (
              <Button onClick={() => setShowOrderDialog(true)}>
                <Package className="h-4 w-4 mr-2" />
                Create Material Order
              </Button>
            )}
          </div>
        </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Item</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Unit Cost</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Total</th>
                  {editable && <th className="w-[50px]"></th>}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, index) => (
                  <tr key={item.template_item_id || index} className="border-b border-border/50">
                    <td className="py-2 px-3 font-medium">{item.item_name}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{item.qty.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(item.unit_cost)}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {formatCurrency(item.line_total)}
                    </td>
                    {editable && (
                      <td className="py-2 px-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteItem(item.template_item_id)}
                          disabled={deletingId === item.template_item_id}
                        >
                          {deletingId === item.template_item_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={editable ? 4 : 3} className="py-2 px-3 font-semibold text-right">Total:</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold">
                    {formatCurrency(totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>

    <MaterialOrderDialog
      open={showOrderDialog}
      onOpenChange={setShowOrderDialog}
      estimateId={estimateId}
      onSuccess={(orderId) => {
        console.log('Order created:', orderId);
      }}
    />
    </>
  );
};