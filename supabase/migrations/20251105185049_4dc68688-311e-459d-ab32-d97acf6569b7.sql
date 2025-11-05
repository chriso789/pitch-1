-- ============================================================================
-- FIX 4 TABLES WITH RLS ENABLED BUT NO POLICIES
-- ============================================================================

-- 1. answering_service_config - Service configuration
CREATE POLICY "Users can view answering service config in their tenant"
  ON public.answering_service_config FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage answering service config"
  ON public.answering_service_config FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- 2. deleted_contacts - Soft delete tracking
CREATE POLICY "Users can view deleted contacts in their tenant"
  ON public.deleted_contacts FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage deleted contacts"
  ON public.deleted_contacts FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- 3. locations - Geographic territories
CREATE POLICY "Users can view locations in their tenant"
  ON public.locations FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage locations"
  ON public.locations FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- 4. user_location_assignments - User territory assignments
CREATE POLICY "Users can view location assignments in their tenant"
  ON public.user_location_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_id AND p.tenant_id = get_user_tenant_id()
  ));

CREATE POLICY "Admins can manage location assignments"
  ON public.user_location_assignments FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_id AND p.tenant_id = get_user_tenant_id()
  ));