-- Add requires_review flag to roof_measurement_facets
ALTER TABLE public.roof_measurement_facets 
ADD COLUMN IF NOT EXISTS requires_review boolean DEFAULT false;

ALTER TABLE public.roof_measurement_facets 
ADD COLUMN IF NOT EXISTS review_reason text;

ALTER TABLE public.roof_measurement_facets 
ADD COLUMN IF NOT EXISTS dsm_confidence numeric(4,3);

-- Add quality tracking to roof_measurements
ALTER TABLE public.roof_measurements 
ADD COLUMN IF NOT EXISTS manual_review_recommended boolean DEFAULT false;

ALTER TABLE public.roof_measurements 
ADD COLUMN IF NOT EXISTS quality_checks jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.roof_measurements 
ADD COLUMN IF NOT EXISTS dsm_available boolean DEFAULT false;

ALTER TABLE public.roof_measurements 
ADD COLUMN IF NOT EXISTS overlay_schema jsonb;

-- Create index for review tracking
CREATE INDEX IF NOT EXISTS idx_roof_measurements_review 
ON public.roof_measurements(manual_review_recommended) 
WHERE manual_review_recommended = true;

CREATE INDEX IF NOT EXISTS idx_roof_facets_review 
ON public.roof_measurement_facets(requires_review) 
WHERE requires_review = true;