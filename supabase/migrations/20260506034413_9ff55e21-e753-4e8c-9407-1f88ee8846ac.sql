
-- Add columns to locations
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS location_code TEXT,
  ADD COLUMN IF NOT EXISTS contact_sequence_counter INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_code_tenant
  ON public.locations (tenant_id, location_code)
  WHERE location_code IS NOT NULL;

-- Auto-generate location codes
UPDATE public.locations
SET location_code = CASE
  WHEN name ILIKE '%west coast%' THEN 'WC'
  WHEN name ILIKE '%east coast%' THEN 'EC'
  WHEN name ILIKE '%austin%' THEN 'ATX'
  WHEN name ILIKE '%dallas%' THEN 'DAL'
  WHEN name ILIKE '%boca%' THEN 'BOC'
  WHEN name ILIKE '%georgia%' THEN 'GA'
  WHEN name ILIKE '%edwardsville%' THEN 'EDW'
  WHEN name ILIKE '%saint louis%' OR name ILIKE '%st. louis%' THEN 'STL'
  WHEN name ILIKE '%miramar%' THEN 'MIR'
  WHEN name ILIKE '%palm beach%' THEN 'PBH'
  WHEN name ILIKE '%psl%' THEN 'PSL'
  WHEN name ILIKE '%main office%' THEN 'HQ'
  ELSE UPPER(LEFT(REPLACE(name, ' ', ''), 3))
END
WHERE location_code IS NULL;

-- Handle HQ duplicates
DO $$
DECLARE
  rec RECORD;
  counter INTEGER := 1;
BEGIN
  FOR rec IN
    SELECT id FROM public.locations
    WHERE location_code = 'HQ'
    ORDER BY created_at
  LOOP
    IF counter > 1 THEN
      UPDATE public.locations SET location_code = 'HQ' || counter WHERE id = rec.id;
    END IF;
    counter := counter + 1;
  END LOOP;
END $$;
