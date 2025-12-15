-- Revoke all access from public/anon roles on spatial_ref_sys
REVOKE ALL ON public.spatial_ref_sys FROM anon;
REVOKE ALL ON public.spatial_ref_sys FROM authenticated;
REVOKE SELECT ON public.spatial_ref_sys FROM public;