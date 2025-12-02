-- Create estimate_template_groups table for grouping items
CREATE TABLE public.estimate_template_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  group_type TEXT NOT NULL DEFAULT 'material',
  sort_order INTEGER NOT NULL DEFAULT 0,
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.estimate_template_groups ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Users can manage template groups in their tenant"
ON public.estimate_template_groups
FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Add new columns to template_items
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.estimate_template_groups(id) ON DELETE SET NULL;
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS estimate_item_name TEXT;
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'material';
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS pricing_type TEXT DEFAULT 'profit_margin';
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(12,2);
ALTER TABLE public.template_items ADD COLUMN IF NOT EXISTS measurement_type TEXT;

-- Add new columns to templates
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS template_type TEXT DEFAULT 'steep_slope';
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS use_for TEXT DEFAULT 'both';
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS profit_margin_percent NUMERIC(5,2) DEFAULT 30.00;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS available_trades TEXT[] DEFAULT ARRAY['Roofing'];
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS template_description TEXT;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_template_groups_template_id ON public.estimate_template_groups(template_id);
CREATE INDEX IF NOT EXISTS idx_template_items_group_id ON public.template_items(group_id);