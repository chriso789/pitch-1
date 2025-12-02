
-- Enable RLS on materials tables (global catalog, authenticated users can read)
ALTER TABLE public.material_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all materials (global catalog)
CREATE POLICY "Authenticated users can read material_categories"
  ON public.material_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read materials"
  ON public.materials FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read supplier_catalogs"
  ON public.supplier_catalogs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read supplier_catalog_items"
  ON public.supplier_catalog_items FOR SELECT
  TO authenticated
  USING (true);

-- Allow admin roles to manage materials
CREATE POLICY "Admins can manage material_categories"
  ON public.material_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('master', 'corporate', 'office_admin')
    )
  );

CREATE POLICY "Admins can manage materials"
  ON public.materials FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('master', 'corporate', 'office_admin')
    )
  );

CREATE POLICY "Admins can manage supplier_catalogs"
  ON public.supplier_catalogs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('master', 'corporate', 'office_admin')
    )
  );

CREATE POLICY "Admins can manage supplier_catalog_items"
  ON public.supplier_catalog_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('master', 'corporate', 'office_admin')
    )
  );
