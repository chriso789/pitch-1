import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMaterialOrders, MaterialOrder, MaterialOrderItem } from '@/hooks/useMaterialOrders';
import { Loader2, Package, Send, XCircle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface MaterialOrderDetailProps {
  orderId: string;
}

export const MaterialOrderDetail: React.FC<MaterialOrderDetailProps> = ({ orderId }) => {
  const { fetchOrderItems, submitOrder, cancelOrder, loading } = useMaterialOrders();
  const [order, setOrder] = useState<MaterialOrder | null>(null);
  const [items, setItems] = useState<MaterialOrderItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadOrderData();
  }, [orderId]);

  const loadOrderData = async () => {
    setLoadingData(true);
    try {
      // Fetch order details
      const { data: orderData, error: orderError } = await import('@/integrations/supabase/client')
        .then(m => m.supabase)
        .then(supabase => supabase
          .from('purchase_orders')
          .select('*, vendors(name)')
          .eq('id', orderId)
          .single()
        );

      if (orderError) throw orderError;
      setOrder(orderData);

      // Fetch items
      const itemsData = await fetchOrderItems(orderId);
      setItems(itemsData);
    } catch (error) {
      console.error('Error loading order:', error);
      toast.error('Failed to load order details');
    } finally {
      setLoadingData(false);
    }
  };

  const handleSubmit = async () => {
    try {
      await submitOrder(orderId);
      await loadOrderData();
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleCancel = async () => {
    try {
      await cancelOrder(orderId);
      await loadOrderData();
    } catch (error) {
      // Error handled in hook
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loadingData) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="ml-2">Loading order details...</span>
        </CardContent>
      </Card>
    );
  }

  if (!order) {
    return (
      <Card>
        <CardContent className="text-center py-8 text-muted-foreground">
          Order not found
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Order Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {order.po_number}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Vendor: {order.vendors?.name || 'Unknown'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{order.status}</Badge>
              {order.status === 'draft' && (
                <>
                  <Button
                    onClick={handleSubmit}
                    disabled={loading}
                    size="sm"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Submit Order
                  </Button>
                  <Button
                    onClick={handleCancel}
                    disabled={loading}
                    variant="destructive"
                    size="sm"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </>
              )}
              {order.status === 'submitted' && (
                <Button
                  onClick={() => toast.info('Order confirmation feature coming soon')}
                  size="sm"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark Received
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Order Date</p>
              <p className="font-medium">
                {format(new Date(order.order_date), 'MMMM d, yyyy')}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Branch Code</p>
              <p className="font-medium">{order.branch_code || 'N/A'}</p>
            </div>
            {order.notes && (
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-sm">{order.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle>Order Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SRS Item Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">
                    {item.srs_item_code || 'N/A'}
                  </TableCell>
                  <TableCell>{item.item_description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(item.unit_price)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(item.line_total)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} className="text-right font-medium">
                  Subtotal
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(order.subtotal)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4} className="text-right font-medium">
                  Shipping
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(order.shipping_amount)}
                </TableCell>
              </TableRow>
              <TableRow className="font-bold">
                <TableCell colSpan={4} className="text-right">
                  Total
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(order.total_amount)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
