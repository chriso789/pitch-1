ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS customer_report_ready boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS internal_debug_report_ready boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_roof_measurements_internal_debug_ready
ON public.roof_measurements (internal_debug_report_ready)
WHERE internal_debug_report_ready = true;

CREATE INDEX IF NOT EXISTS idx_roof_measurements_customer_report_ready
ON public.roof_measurements (customer_report_ready)
WHERE customer_report_ready = true;