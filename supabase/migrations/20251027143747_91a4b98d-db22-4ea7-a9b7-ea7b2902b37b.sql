-- Phase 29: Change Order Management Tables

-- Main change orders table
CREATE TABLE IF NOT EXISTS change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  co_number VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  reason TEXT,
  requested_by UUID REFERENCES profiles(id),
  status VARCHAR(50) DEFAULT 'draft',
  original_scope TEXT,
  new_scope TEXT,
  cost_impact NUMERIC DEFAULT 0,
  time_impact_days INTEGER DEFAULT 0,
  requested_date TIMESTAMPTZ DEFAULT now(),
  approved_date TIMESTAMPTZ,
  approved_by UUID REFERENCES profiles(id),
  completed_date TIMESTAMPTZ,
  rejection_reason TEXT,
  customer_approved BOOLEAN DEFAULT false,
  customer_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_co_number_per_tenant UNIQUE (tenant_id, co_number)
);

-- Change order line items
CREATE TABLE IF NOT EXISTS change_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id UUID NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  item_type VARCHAR(50),
  description TEXT,
  quantity NUMERIC,
  unit_price NUMERIC,
  total_price NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_line_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for change_orders
CREATE POLICY "Users can view change orders in their tenant"
  ON change_orders FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create change orders in their tenant"
  ON change_orders FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update change orders in their tenant"
  ON change_orders FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Managers can delete change orders in their tenant"
  ON change_orders FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies for change_order_line_items
CREATE POLICY "Users can view change order line items in their tenant"
  ON change_order_line_items FOR SELECT
  USING (change_order_id IN (
    SELECT id FROM change_orders WHERE tenant_id = get_user_tenant_id()
  ));

CREATE POLICY "Users can manage change order line items in their tenant"
  ON change_order_line_items FOR ALL
  USING (change_order_id IN (
    SELECT id FROM change_orders WHERE tenant_id = get_user_tenant_id()
  ));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_change_orders_tenant_id ON change_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_project_id ON change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_status ON change_orders(status);
CREATE INDEX IF NOT EXISTS idx_change_order_line_items_change_order_id ON change_order_line_items(change_order_id);