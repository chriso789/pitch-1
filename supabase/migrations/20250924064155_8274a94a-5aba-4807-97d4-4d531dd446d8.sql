-- Check what material cost tables already exist and create only missing ones

-- Create vendors table (if not exists)
CREATE TABLE IF NOT EXISTS public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  vendor_code TEXT NOT NULL,
  api_endpoint TEXT,
  api_credentials JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, vendor_code)
);

-- Create products table (master catalog)
CREATE TABLE IF NOT EXISTS public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit_of_measure TEXT DEFAULT 'EA',
  category TEXT,
  subcategory TEXT,
  manufacturer TEXT,
  model_number TEXT,
  weight_lbs NUMERIC,
  dimensions JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, sku)
);

-- Create vendor_products table (vendor-specific product mappings)
CREATE TABLE IF NOT EXISTS public.vendor_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vendor_sku TEXT NOT NULL,
  vendor_name TEXT,
  vendor_description TEXT,
  base_price NUMERIC DEFAULT 0,
  minimum_order_qty INTEGER DEFAULT 1,
  lead_time_days INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, vendor_id, vendor_sku)
);

-- Create price_cache table (live pricing with cache)
CREATE TABLE IF NOT EXISTS public.price_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL,
  price NUMERIC NOT NULL,
  list_price NUMERIC,
  discount_percent NUMERIC DEFAULT 0,
  effective_date DATE DEFAULT CURRENT_DATE,
  expires_at TIMESTAMP WITH TIME ZONE,
  seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  source TEXT DEFAULT 'api', -- 'api', 'csv', 'manual'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, vendor_id, product_id, branch_code)
);

-- Create purchase_orders table
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  po_number TEXT NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  project_id UUID REFERENCES public.projects(id),
  branch_code TEXT,
  status TEXT DEFAULT 'draft',
  order_date DATE DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  actual_delivery_date DATE,
  subtotal NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  shipping_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  delivery_address JSONB DEFAULT '{}',
  notes TEXT,
  tracking_number TEXT,
  external_order_id TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, po_number)
);

-- Create purchase_order_items table
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  vendor_product_id UUID REFERENCES public.vendor_products(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  line_total NUMERIC NOT NULL,
  delivered_quantity INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Only enable RLS on new tables that don't already exist
DO $$
BEGIN
  -- Check each table and enable RLS if it doesn't already have it
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendors') THEN
    ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products') THEN
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_products') THEN
    ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'price_cache') THEN
    ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders') THEN
    ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_items') THEN
    ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;