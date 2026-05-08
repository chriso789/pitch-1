
-- Create benchmark table for vendor comparison
CREATE TABLE public.roof_measurement_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  vendor TEXT NOT NULL DEFAULT 'roofr',
  vendor_report_id TEXT,
  area_sqft DECIMAL(10,2),
  facets INTEGER,
  pitch_rise_per_12 DECIMAL(5,2),
  eave_lf DECIMAL(10,2),
  valley_lf DECIMAL(10,2),
  hip_lf DECIMAL(10,2),
  ridge_lf DECIMAL(10,2),
  rake_lf DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.roof_measurement_benchmarks ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read benchmarks
CREATE POLICY "Authenticated users can read benchmarks"
  ON public.roof_measurement_benchmarks
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed Fonsica benchmark
INSERT INTO public.roof_measurement_benchmarks (address, vendor, area_sqft, facets, pitch_rise_per_12, eave_lf, valley_lf, hip_lf, ridge_lf, rake_lf)
VALUES ('4063 Fonsica Ave', 'roofr', 3077, 14, 6.0, 258.75, 64.25, 201.83, 30.17, 5.25);
