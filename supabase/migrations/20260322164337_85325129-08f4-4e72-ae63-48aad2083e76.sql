DROP POLICY IF EXISTS "Tenant isolation for customer_photos" ON customer_photos;

CREATE POLICY "Tenant isolation for customer_photos" ON customer_photos
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
      UNION
      SELECT profiles.active_tenant_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.active_tenant_id IS NOT NULL
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
      UNION
      SELECT profiles.active_tenant_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.active_tenant_id IS NOT NULL
    )
  );