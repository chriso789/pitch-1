-- Public, read-only RPC for the parser to enumerate EagleView vendor diagrams.
-- Returns id, address, and the pre-signed diagram_image_url only.
-- The URLs themselves are already pre-signed objects, so this RPC does not
-- expand the attack surface beyond what those signed URLs already grant.
CREATE OR REPLACE FUNCTION public.list_eagleview_diagrams()
RETURNS TABLE (
  id UUID,
  address TEXT,
  diagram_image_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, address, diagram_image_url
  FROM public.roof_vendor_reports
  WHERE provider = 'eagleview'
    AND diagram_image_url IS NOT NULL
  ORDER BY created_at DESC
$$;

REVOKE ALL ON FUNCTION public.list_eagleview_diagrams() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_eagleview_diagrams() TO anon, authenticated;