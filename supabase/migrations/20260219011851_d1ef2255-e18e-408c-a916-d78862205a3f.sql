
-- Backfill existing NULL qualification_status to 'unqualified'
UPDATE public.contacts
SET qualification_status = 'unqualified'
WHERE qualification_status IS NULL;

-- Create trigger function to auto-set default qualification_status on INSERT
CREATE OR REPLACE FUNCTION public.set_default_qualification_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.qualification_status IS NULL THEN
    NEW.qualification_status := 'unqualified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
CREATE TRIGGER trg_set_default_qualification_status
  BEFORE INSERT ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_qualification_status();
