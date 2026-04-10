-- Step 1: Add tenant_id column to roof_measurements
ALTER TABLE public.roof_measurements ADD COLUMN tenant_id uuid REFERENCES public.tenants(id);

-- Step 2: Backfill
UPDATE public.roof_measurements
SET tenant_id = COALESCE(
  organization_id,
  (SELECT p.tenant_id FROM public.profiles p WHERE p.id = measured_by LIMIT 1)
);

-- Step 3: Fix roof_measurements policies
DROP POLICY IF EXISTS "Users can view their measurements" ON public.roof_measurements;
DROP POLICY IF EXISTS "Users can view measurements" ON public.roof_measurements;
DROP POLICY IF EXISTS "Authenticated users can view measurements" ON public.roof_measurements;
DROP POLICY IF EXISTS "Users can create measurements" ON public.roof_measurements;
DROP POLICY IF EXISTS "Users can update their measurements" ON public.roof_measurements;
DROP POLICY IF EXISTS "Service role full access" ON public.roof_measurements;

CREATE POLICY "Tenant users can view measurements" ON public.roof_measurements
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Tenant users can create measurements" ON public.roof_measurements
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "Tenant users can update measurements" ON public.roof_measurements
  FOR UPDATE TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Service role full access" ON public.roof_measurements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Step 4: Fix measurement_jobs (tenant_id is TEXT type)
DROP POLICY IF EXISTS "Users can view measurement jobs" ON public.measurement_jobs;
CREATE POLICY "Tenant users can view measurement jobs" ON public.measurement_jobs
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id()::text);

-- Step 5: Fix satellite_image_cache
DROP POLICY IF EXISTS "Authenticated users can view satellite cache" ON public.satellite_image_cache;
CREATE POLICY "Tenant users can view satellite cache" ON public.satellite_image_cache
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id());