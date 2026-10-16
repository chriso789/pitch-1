DROP POLICY IF EXISTS "Service role can delete satellite images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can insert satellite images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update satellite images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage satellite-imagery" ON storage.objects;
CREATE POLICY "Service role writes satellite-cache" ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'satellite-cache') WITH CHECK (bucket_id = 'satellite-cache');
CREATE POLICY "Service role manages satellite-imagery" ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'satellite-imagery') WITH CHECK (bucket_id = 'satellite-imagery');
CREATE POLICY "Signed-in read satellite-imagery" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'satellite-imagery');