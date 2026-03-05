ALTER TABLE public.enhanced_estimates
ADD CONSTRAINT enhanced_estimates_created_by_fkey
FOREIGN KEY (created_by) REFERENCES public.profiles(id);