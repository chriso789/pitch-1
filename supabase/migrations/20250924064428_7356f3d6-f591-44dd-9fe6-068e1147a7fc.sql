-- Fix missing columns and create RLS policies for material cost system

-- Add missing columns to price_cache table if they don't exist
DO $$
BEGIN
  -- Add seen_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'price_cache' AND column_name = 'seen_at') THEN
    ALTER TABLE public.price_cache ADD COLUMN seen_at TIMESTAMP WITH TIME ZONE DEFAULT now();
  END IF;
  
  -- Add other potentially missing columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'price_cache' AND column_name = 'source') THEN
    ALTER TABLE public.price_cache ADD COLUMN source TEXT DEFAULT 'api';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'price_cache' AND column_name = 'metadata') THEN
    ALTER TABLE public.price_cache ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END
$$;

-- Create RLS policies only if they don't exist

-- Vendors policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendors' AND policyname = 'Users can view vendors in their tenant') THEN
    CREATE POLICY "Users can view vendors in their tenant" ON public.vendors
    FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendors' AND policyname = 'Admins can manage vendors in their tenant') THEN
    CREATE POLICY "Admins can manage vendors in their tenant" ON public.vendors
    FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));
  END IF;
END
$$;

-- Products policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Users can view products in their tenant') THEN
    CREATE POLICY "Users can view products in their tenant" ON public.products
    FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Admins can manage products in their tenant') THEN
    CREATE POLICY "Admins can manage products in their tenant" ON public.products
    FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));
  END IF;
END
$$;

-- Vendor products policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_products' AND policyname = 'Users can view vendor products in their tenant') THEN
    CREATE POLICY "Users can view vendor products in their tenant" ON public.vendor_products
    FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_products' AND policyname = 'Admins can manage vendor products in their tenant') THEN
    CREATE POLICY "Admins can manage vendor products in their tenant" ON public.vendor_products
    FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));
  END IF;
END
$$;

-- Price cache policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'price_cache' AND policyname = 'Users can view price cache in their tenant') THEN
    CREATE POLICY "Users can view price cache in their tenant" ON public.price_cache
    FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'price_cache' AND policyname = 'System can manage price cache in tenant') THEN
    CREATE POLICY "System can manage price cache in tenant" ON public.price_cache
    FOR ALL USING (tenant_id = get_user_tenant_id());
  END IF;
END
$$;

-- Purchase orders policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'Users can view purchase orders in their tenant') THEN
    CREATE POLICY "Users can view purchase orders in their tenant" ON public.purchase_orders
    FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'Users can create purchase orders in their tenant') THEN
    CREATE POLICY "Users can create purchase orders in their tenant" ON public.purchase_orders
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'Users can update purchase orders in their tenant') THEN
    CREATE POLICY "Users can update purchase orders in their tenant" ON public.purchase_orders
    FOR UPDATE USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'Admins can delete purchase orders in their tenant') THEN
    CREATE POLICY "Admins can delete purchase orders in their tenant" ON public.purchase_orders
    FOR DELETE USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));
  END IF;
END
$$;

-- Purchase order items policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_items' AND policyname = 'Users can view purchase order items in their tenant') THEN
    CREATE POLICY "Users can view purchase order items in their tenant" ON public.purchase_order_items
    FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_items' AND policyname = 'Users can manage purchase order items in their tenant') THEN
    CREATE POLICY "Users can manage purchase order items in their tenant" ON public.purchase_order_items
    FOR ALL USING (tenant_id = get_user_tenant_id());
  END IF;
END
$$;

-- Create essential indexes
DO $$
BEGIN
  -- Only create the essential indexes, skip the problematic one for now
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vendors_tenant_code') THEN
    CREATE INDEX idx_vendors_tenant_code ON public.vendors(tenant_id, vendor_code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_products_tenant_sku') THEN
    CREATE INDEX idx_products_tenant_sku ON public.products(tenant_id, sku);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_price_cache_lookup') THEN
    CREATE INDEX idx_price_cache_lookup ON public.price_cache(tenant_id, vendor_id, product_id, branch_code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_purchase_orders_tenant_status') THEN
    CREATE INDEX idx_purchase_orders_tenant_status ON public.purchase_orders(tenant_id, status);
  END IF;
END
$$;