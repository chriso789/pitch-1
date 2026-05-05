
ALTER TABLE public.ai_answering_config
  ADD COLUMN IF NOT EXISTS forward_name TEXT,
  ADD COLUMN IF NOT EXISTS forward_phone TEXT;

COMMENT ON COLUMN public.ai_answering_config.forward_name IS 'Name announced in IVR menu, e.g. Press 1 to reach <name>';
COMMENT ON COLUMN public.ai_answering_config.forward_phone IS 'E.164 phone number to transfer callers to when they press 1';
