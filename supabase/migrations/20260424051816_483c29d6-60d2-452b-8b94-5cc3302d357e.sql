ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS established_year INTEGER,
  ADD COLUMN IF NOT EXISTS brand_story TEXT,
  ADD COLUMN IF NOT EXISTS brand_mission TEXT,
  ADD COLUMN IF NOT EXISTS brand_certifications TEXT;

-- Default O'Brien Contracting to founded in 2016
UPDATE public.tenants
SET established_year = 2016
WHERE established_year IS NULL
  AND (LOWER(name) LIKE '%o''brien%' OR LOWER(name) LIKE '%obrien%');