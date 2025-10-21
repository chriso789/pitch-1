import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface MaterialOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  project_id: string;
  branch_code?: string;
  status: string;
  order_date: string;
  expected_delivery_date?: string;
  subtotal: number;
  shipping_amount: number;
  total_amount: number;
  delivery_address?: any;
  notes?: string;
  created_at: string;
  vendors?: { name: string };
}

export interface MaterialOrderItem {
  id: string;
  po_id: string;
  product_id?: string;
  srs_item_code?: string;
  item_description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  metadata?: any;
}

export const useMaterialOrders = () => {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<MaterialOrder[]>([]);

  const createOrderFromEstimate = async (
    estimateId: string,
    vendorId: string,
    options?: {
      deliveryAddress?: any;
      branchCode?: string;
      notes?: string;
    }
  ) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('api_create_material_order_from_estimate', {
        p_estimate_id: estimateId,
        p_vendor_id: vendorId,
        p_delivery_address: options?.deliveryAddress || null,
        p_branch_code: options?.branchCode || null,
        p_notes: options?.notes || null
      });

      if (error) throw error;

      toast.success('Material order created successfully');
      return data as string; // Returns order ID
    } catch (error: any) {
      console.error('Error creating material order:', error);
      toast.error(error.message || 'Failed to create material order');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async (filters?: { status?: string; projectId?: string }) => {
    setLoading(true);
    try {
      let query = supabase
        .from('purchase_orders')
        .select(`
          *,
          vendors (name)
        `)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.projectId) {
        query = query.eq('project_id', filters.projectId);
      }

      const { data, error } = await query;

      if (error) throw error;

      setOrders(data || []);
      return data || [];
    } catch (error: any) {
      console.error('Error fetching orders:', error);
      toast.error('Failed to load orders');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderItems = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('*')
        .eq('po_id', orderId)
        .order('created_at');

      if (error) throw error;

      return data as MaterialOrderItem[];
    } catch (error: any) {
      console.error('Error fetching order items:', error);
      toast.error('Failed to load order items');
      throw error;
    }
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('purchase_orders')
        .update({ status })
        .eq('id', orderId);

      if (error) throw error;

      toast.success(`Order status updated to ${status}`);
      await fetchOrders(); // Refresh list
    } catch (error: any) {
      console.error('Error updating order status:', error);
      toast.error('Failed to update order status');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const submitOrder = async (orderId: string) => {
    return updateOrderStatus(orderId, 'submitted');
  };

  const cancelOrder = async (orderId: string, reason?: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'cancelled',
          notes: reason ? `Cancelled: ${reason}` : 'Cancelled'
        })
        .eq('id', orderId);

      if (error) throw error;

      toast.success('Order cancelled');
      await fetchOrders();
    } catch (error: any) {
      console.error('Error cancelling order:', error);
      toast.error('Failed to cancel order');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    orders,
    createOrderFromEstimate,
    fetchOrders,
    fetchOrderItems,
    updateOrderStatus,
    submitOrder,
    cancelOrder
  };
};
