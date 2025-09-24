-- Create vendors table
CREATE TABLE public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL, -- vendor identifier/code
  contact_email TEXT,
  contact_phone TEXT,
  address JSONB DEFAULT '{}',
  api_config JSONB DEFAULT '{}', -- API keys, endpoints, etc.
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, code)
);

-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit_of_measure TEXT DEFAULT 'EA', -- EA, LF, SQ, etc.
  manufacturer TEXT,
  specifications JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, sku)
);

-- Create vendor_products table (junction table with vendor-specific data)
CREATE TABLE public.vendor_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vendor_sku TEXT, -- vendor's SKU for this product
  vendor_product_name TEXT,
  minimum_order_qty NUMERIC DEFAULT 1,
  lead_time_days INTEGER DEFAULT 0,
  is_preferred BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, vendor_id, product_id)
);

-- Create price_cache table
CREATE TABLE public.price_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_code TEXT, -- branch/location identifier
  price NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  quantity_break NUMERIC DEFAULT 1, -- price break quantity
  effective_date DATE DEFAULT CURRENT_DATE,
  expires_at DATE,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  source_type TEXT NOT NULL, -- 'api', 'csv', 'manual'
  source_data JSONB DEFAULT '{}', -- original API response or metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, vendor_id, product_id, branch_code, quantity_break)
);

-- Create vendor_orders table for tracking orders
CREATE TABLE public.vendor_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  project_id UUID REFERENCES public.projects(id),
  order_number TEXT NOT NULL,
  vendor_order_id TEXT, -- vendor's order ID
  status TEXT DEFAULT 'draft', -- draft, submitted, confirmed, shipped, delivered, cancelled
  order_date DATE DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  actual_delivery_date DATE,
  total_amount NUMERIC(10,2) DEFAULT 0,
  shipping_address JSONB DEFAULT '{}',
  notes TEXT,
  order_data JSONB DEFAULT '{}', -- full order payload
  tracking_data JSONB DEFAULT '{}', -- delivery tracking info
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, order_number)
);

-- Create vendor_order_items table
CREATE TABLE public.vendor_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.vendor_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  vendor_sku TEXT,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_order_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for vendors
CREATE POLICY "Users can view vendors in their tenant"
ON public.vendors FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage vendors in their tenant"
ON public.vendors FOR ALL
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for products
CREATE POLICY "Users can view products in their tenant"
ON public.products FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage products in their tenant"
ON public.products FOR ALL
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for vendor_products
CREATE POLICY "Users can view vendor products in their tenant"
ON public.vendor_products FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage vendor products in their tenant"
ON public.vendor_products FOR ALL
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for price_cache
CREATE POLICY "Users can view price cache in their tenant"
ON public.price_cache FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage price cache in tenant"
ON public.price_cache FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create RLS policies for vendor_orders
CREATE POLICY "Users can view vendor orders in their tenant"
ON public.vendor_orders FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage vendor orders in their tenant"
ON public.vendor_orders FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create RLS policies for vendor_order_items
CREATE POLICY "Users can view vendor order items in their tenant"
ON public.vendor_order_items FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage vendor order items in their tenant"
ON public.vendor_order_items FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create indexes for performance
CREATE INDEX idx_vendors_tenant_code ON public.vendors(tenant_id, code);
CREATE INDEX idx_products_tenant_sku ON public.products(tenant_id, sku);
CREATE INDEX idx_vendor_products_tenant_vendor ON public.vendor_products(tenant_id, vendor_id);
CREATE INDEX idx_price_cache_lookup ON public.price_cache(tenant_id, vendor_id, product_id, branch_code);
CREATE INDEX idx_price_cache_last_seen ON public.price_cache(last_seen_at);
CREATE INDEX idx_vendor_orders_tenant_status ON public.vendor_orders(tenant_id, status);

-- Create triggers for updated_at
CREATE TRIGGER update_vendors_updated_at
BEFORE UPDATE ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vendor_products_updated_at
BEFORE UPDATE ON public.vendor_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_price_cache_updated_at
BEFORE UPDATE ON public.price_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vendor_orders_updated_at
BEFORE UPDATE ON public.vendor_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();