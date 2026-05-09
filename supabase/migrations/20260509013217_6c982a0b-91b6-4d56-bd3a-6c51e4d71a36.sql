CREATE TABLE IF NOT EXISTS public.material_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  source_filename TEXT,
  supplier_name TEXT,
  source_type TEXT NOT NULL DEFAULT 'csv',
  items_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.material_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view import batches"
  ON public.material_import_batches FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Authenticated users can insert import batches"
  ON public.material_import_batches FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_material_import_batches_created
  ON public.material_import_batches(created_at DESC);