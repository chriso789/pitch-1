
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS srs_environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS srs_debug_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenant_settings
  DROP CONSTRAINT IF EXISTS tenant_settings_srs_environment_check;
ALTER TABLE public.tenant_settings
  ADD CONSTRAINT tenant_settings_srs_environment_check
  CHECK (srs_environment IN ('production','qa','debug'));

NOTIFY pgrst, 'reload schema';
