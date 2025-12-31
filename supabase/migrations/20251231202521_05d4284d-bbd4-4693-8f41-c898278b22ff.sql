-- Create tables for estimate calculation template items
-- These reference estimate_calculation_templates (NOT the old templates table)

-- Groups for estimate calculation templates
CREATE TABLE IF NOT EXISTS public.estimate_calc_template_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  calc_template_id UUID NOT NULL REFERENCES public.estimate_calculation_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  group_type TEXT NOT NULL CHECK (group_type IN ('material', 'labor')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Items for estimate calculation templates
CREATE TABLE IF NOT EXISTS public.estimate_calc_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  calc_template_id UUID NOT NULL REFERENCES public.estimate_calculation_templates(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.estimate_calc_template_groups(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('material', 'labor')),
  item_name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'each',
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  qty_formula TEXT NOT NULL DEFAULT '1',
  sku_pattern TEXT,
  manufacturer TEXT,
  measurement_type TEXT,
  coverage_per_unit NUMERIC(10,2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_calc_template_groups_tenant ON public.estimate_calc_template_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calc_template_groups_template ON public.estimate_calc_template_groups(calc_template_id);
CREATE INDEX IF NOT EXISTS idx_calc_template_items_tenant ON public.estimate_calc_template_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calc_template_items_template ON public.estimate_calc_template_items(calc_template_id);
CREATE INDEX IF NOT EXISTS idx_calc_template_items_group ON public.estimate_calc_template_items(group_id);

-- Enable RLS
ALTER TABLE public.estimate_calc_template_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_calc_template_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for groups
CREATE POLICY "Tenant users can view their template groups"
  ON public.estimate_calc_template_groups FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant users can insert their template groups"
  ON public.estimate_calc_template_groups FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant users can update their template groups"
  ON public.estimate_calc_template_groups FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant users can delete their template groups"
  ON public.estimate_calc_template_groups FOR DELETE
  USING (tenant_id = public.get_user_tenant_id());

-- RLS policies for items
CREATE POLICY "Tenant users can view their template items"
  ON public.estimate_calc_template_items FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant users can insert their template items"
  ON public.estimate_calc_template_items FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant users can update their template items"
  ON public.estimate_calc_template_items FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant users can delete their template items"
  ON public.estimate_calc_template_items FOR DELETE
  USING (tenant_id = public.get_user_tenant_id());