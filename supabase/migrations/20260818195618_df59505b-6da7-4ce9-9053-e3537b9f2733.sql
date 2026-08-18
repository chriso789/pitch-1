
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS commission_rate_self_generated numeric,
  ADD COLUMN IF NOT EXISTS commission_rate_company_generated numeric;

ALTER TABLE public.pipeline_entries
  ADD COLUMN IF NOT EXISTS lead_generation_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_entries_lead_generation_type_check'
  ) THEN
    ALTER TABLE public.pipeline_entries
      ADD CONSTRAINT pipeline_entries_lead_generation_type_check
      CHECK (lead_generation_type IS NULL OR lead_generation_type IN ('self_generated','company_generated'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_lead_generation_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_generation_type IS NULL THEN
    IF NEW.created_by IS NOT NULL AND NEW.assigned_to IS NOT NULL AND NEW.created_by = NEW.assigned_to THEN
      NEW.lead_generation_type := 'self_generated';
    ELSE
      NEW.lead_generation_type := 'company_generated';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_lead_generation_type ON public.pipeline_entries;
CREATE TRIGGER trg_set_lead_generation_type
BEFORE INSERT ON public.pipeline_entries
FOR EACH ROW EXECUTE FUNCTION public.set_lead_generation_type();

UPDATE public.pipeline_entries
SET lead_generation_type = CASE
  WHEN created_by IS NOT NULL AND assigned_to IS NOT NULL AND created_by = assigned_to THEN 'self_generated'
  ELSE 'company_generated'
END
WHERE lead_generation_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_lead_generation_type
  ON public.pipeline_entries (tenant_id, lead_generation_type);
