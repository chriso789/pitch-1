import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useMaterialOrders, MaterialOrder, MaterialOrderItem } from '@/hooks/useMaterialOrders';
import { ArrowLeft, Package, Calendar, DollarSign, Building2, FileText, MapPin, Send, XCircle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MaterialOrderExport } from '@/components/orders/MaterialOrderExport';

export default function MaterialOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { submitOrder, cancelOrder, updateOrderStatus, requestApproval } = useMaterialOrders();
  const [order, setOrder] = useState<MaterialOrder | null>(null);
  const [items, setItems] = useState<MaterialOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);

  useEffect(() => {
    if (id) {
      fetchOrderDetails();
    }
  }, [id]);

  const fetchOrderDetails = async () => {
    if (!id) return;
    
    setLoading(true);
    try {
      // Fetch order
      const { data: orderData, error: orderError } = await supabase
        .from('purchase_orders')
        .select('*, vendors (name)')
        .eq('id', id)
        .single();

      if (orderError) throw orderError;
      setOrder(orderData);

      // Fetch items
      const { data: itemsData, error: itemsError } = await supabase
        .from('purchase_order_items')
        .select('*')
        .eq('po_id', id)
        .order('created_at');

      if (itemsError) throw itemsError;
      setItems(itemsData || []);
    } catch (error: any) {
      console.error('Error fetching order details:', error);
      toast.error('Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!id) return;
    try {
      await submitOrder(id);
      setShowSubmitDialog(false);
      await fetchOrderDetails();
      toast.success('Order submitted successfully');
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    try {
      await cancelOrder(id);
      setShowCancelDialog(false);
      await fetchOrderDetails();
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id) return;
    try {
      await updateOrderStatus(id, newStatus);
      await fetchOrderDetails();
    } catch (error) {
      // Error handled in hook
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-500',
      submitted: 'bg-blue-500',
      confirmed: 'bg-green-500',
      shipped: 'bg-purple-500',
      delivered: 'bg-emerald-500',
      cancelled: 'bg-red-500',
    };
    return colors[status] || 'bg-gray-500';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="text-center py-12">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Order not found</h3>
            <Button onClick={() => navigate('/material-orders')}>
              Back to Orders
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canSubmit = order.status === 'draft';
  const canCancel = ['draft', 'submitted', 'confirmed'].includes(order.status);
  const canMarkConfirmed = order.status === 'submitted';
  const canMarkShipped = order.status === 'confirmed';
  const canMarkDelivered = order.status === 'shipped';

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/material-orders')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <FileText className="h-8 w-8" />
              {order.po_number}
            </h1>
            <p className="text-muted-foreground">Purchase Order Details</p>
          </div>
        </div>
        <div className="flex gap-2">
          <MaterialOrderExport order={order} items={items} />
          {canSubmit && (
            <>
              <Button onClick={() => setShowSubmitDialog(true)}>
                <Send className="h-4 w-4 mr-2" />
                Submit Order
              </Button>
              <Button variant="outline" onClick={() => requestApproval(order.id)}>
                Request Approval
              </Button>
            </>
          )}
          {canMarkConfirmed && (
            <Button variant="outline" onClick={() => handleStatusChange('confirmed')}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Confirmed
            </Button>
          )}
          {canMarkShipped && (
            <Button variant="outline" onClick={() => handleStatusChange('shipped')}>
              <Package className="h-4 w-4 mr-2" />
              Mark Shipped
            </Button>
          )}
          {canMarkDelivered && (
            <Button variant="outline" onClick={() => handleStatusChange('delivered')}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Delivered
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={() => setShowCancelDialog(true)}>
              <XCircle className="h-4 w-4 mr-2" />
              Cancel Order
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Order Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge className={getStatusColor(order.status)}>
                {order.status}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Vendor</span>
              <span className="font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {order.vendors?.name || 'Unknown'}
              </span>
            </div>
            {order.branch_code && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Branch Code</span>
                  <span className="font-mono">{order.branch_code}</span>
                </div>
              </>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Order Date</span>
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {format(new Date(order.order_date), 'MMM dd, yyyy')}
              </span>
            </div>
            {order.expected_delivery_date && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Expected Delivery</span>
                  <span className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {format(new Date(order.expected_delivery_date), 'MMM dd, yyyy')}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold">{formatCurrency(order.subtotal)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Shipping</span>
              <span className="font-semibold">{formatCurrency(order.shipping_amount)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between text-lg">
              <span className="font-semibold">Total Amount</span>
              <span className="font-bold flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {formatCurrency(order.total_amount)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {order.delivery_address && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Delivery Address
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm whitespace-pre-wrap">
              {typeof order.delivery_address === 'string' 
                ? order.delivery_address 
                : JSON.stringify(order.delivery_address, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {order.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{order.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Order Items</CardTitle>
          <CardDescription>{items.length} items in this order</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">
                    {item.srs_item_code || item.product_id || 'N/A'}
                  </TableCell>
                  <TableCell>{item.item_description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unit_price)}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(item.line_total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will submit the order to the vendor. You can still cancel it after submission if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit}>Submit Order</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the order. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground">
              Cancel Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
