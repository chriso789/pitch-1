-- Fix foreign key on quote_tracking_links to reference enhanced_estimates instead of estimates
-- This is safe because quote_tracking_links has 0 rows in Test

ALTER TABLE public.quote_tracking_links
  DROP CONSTRAINT IF EXISTS quote_tracking_links_estimate_id_fkey;

ALTER TABLE public.quote_tracking_links
  ADD CONSTRAINT quote_tracking_links_estimate_id_fkey
  FOREIGN KEY (estimate_id)
  REFERENCES public.enhanced_estimates(id)
  ON DELETE CASCADE;