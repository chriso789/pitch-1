-- Fix canvassiq_properties RLS to support company switching via active_tenant_id
-- Matches pattern used on canvass_areas, canvass_area_assignments, canvass_area_properties

DROP POLICY IF EXISTS "canvassiq_properties_select" ON canvassiq_properties;
CREATE POLICY "canvassiq_properties_select" ON canvassiq_properties
  FOR SELECT TO authenticated
  USING (
    tenant_id = (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "canvassiq_properties_insert" ON canvassiq_properties;
CREATE POLICY "canvassiq_properties_insert" ON canvassiq_properties
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "canvassiq_properties_update" ON canvassiq_properties;
CREATE POLICY "canvassiq_properties_update" ON canvassiq_properties
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "canvassiq_properties_delete" ON canvassiq_properties;
CREATE POLICY "canvassiq_properties_delete" ON canvassiq_properties
  FOR DELETE TO authenticated
  USING (
    tenant_id = (
      SELECT COALESCE(p.active_tenant_id, p.tenant_id)
      FROM profiles p WHERE p.id = auth.uid()
    )
  );