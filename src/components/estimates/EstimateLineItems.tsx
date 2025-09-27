import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

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
}

export const EstimateLineItems: React.FC<EstimateLineItemsProps> = ({
  estimateId,
  className = ''
}) => {
  const [loading, setLoading] = useState(true);
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    <Card className={className}>
      <CardHeader>
        <CardTitle>Estimate Line Items</CardTitle>
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
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={3} className="py-2 px-3 font-semibold text-right">Total:</td>
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
  );
};