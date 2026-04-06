ALTER TABLE public.roof_vendor_reports
  ADD COLUMN IF NOT EXISTS geocoded_lat double precision,
  ADD COLUMN IF NOT EXISTS geocoded_lng double precision;