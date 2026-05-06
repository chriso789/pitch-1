-- Drop the obsolete trigger that calls the old 2-arg format_clj_number
DROP TRIGGER IF EXISTS trigger_assign_lead_number ON public.pipeline_entries;

-- Drop the obsolete function
DROP FUNCTION IF EXISTS public.trigger_assign_lead_number() CASCADE;