-- Fix search path security warnings for new functions
ALTER FUNCTION public.generate_clj_number() SET search_path = 'public';
ALTER FUNCTION public.auto_assign_clj_number() SET search_path = 'public';