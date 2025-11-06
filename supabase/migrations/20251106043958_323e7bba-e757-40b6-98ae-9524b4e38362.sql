-- Create roof_facets table for detailed facet-level measurements
CREATE TABLE IF NOT EXISTS public.roof_facets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  facet_number INTEGER NOT NULL,
  area_sqft NUMERIC(10, 2) NOT NULL,
  plan_area_sqft NUMERIC(10, 2),
  pitch TEXT NOT NULL,
  pitch_degrees NUMERIC(5, 2),
  pitch_factor NUMERIC(5, 3),
  direction TEXT,
  azimuth_degrees NUMERIC(5, 2),
  is_flat BOOLEAN DEFAULT false,
  geometry_wkt TEXT,
  perimeter_ft NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(measurement_id, facet_number)
);

-- Create roof_waste_calculations table for pre-calculated waste scenarios
CREATE TABLE IF NOT EXISTS public.roof_waste_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  waste_percentage INTEGER NOT NULL CHECK (waste_percentage >= 0 AND waste_percentage <= 100),
  base_area_sqft NUMERIC(10, 2) NOT NULL,
  waste_area_sqft NUMERIC(10, 2) NOT NULL,
  total_area_sqft NUMERIC(10, 2) NOT NULL,
  base_squares NUMERIC(10, 2) NOT NULL,
  waste_squares NUMERIC(10, 2) NOT NULL,
  total_squares NUMERIC(10, 2) NOT NULL,
  shingle_bundles INTEGER,
  starter_lf NUMERIC(10, 2),
  ridge_cap_bundles INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(measurement_id, waste_percentage)
);

-- Enable RLS
ALTER TABLE public.roof_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_waste_calculations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for roof_facets
CREATE POLICY "Users can view facets in their tenant"
  ON public.roof_facets FOR SELECT
  USING (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "System can insert facets"
  ON public.roof_facets FOR INSERT
  WITH CHECK (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "System can update facets"
  ON public.roof_facets FOR UPDATE
  USING (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "System can delete facets"
  ON public.roof_facets FOR DELETE
  USING (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

-- RLS Policies for roof_waste_calculations
CREATE POLICY "Users can view waste calculations in their tenant"
  ON public.roof_waste_calculations FOR SELECT
  USING (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "System can insert waste calculations"
  ON public.roof_waste_calculations FOR INSERT
  WITH CHECK (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "System can update waste calculations"
  ON public.roof_waste_calculations FOR UPDATE
  USING (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "System can delete waste calculations"
  ON public.roof_waste_calculations FOR DELETE
  USING (
    measurement_id IN (
      SELECT m.id FROM public.measurements m
      INNER JOIN public.pipeline_entries pe ON m.property_id = pe.id
      WHERE pe.tenant_id = get_user_tenant_id()
    )
  );

-- Create indexes for performance
CREATE INDEX idx_roof_facets_measurement_id ON public.roof_facets(measurement_id);
CREATE INDEX idx_roof_facets_pitch ON public.roof_facets(pitch);
CREATE INDEX idx_roof_waste_calculations_measurement_id ON public.roof_waste_calculations(measurement_id);
CREATE INDEX idx_roof_waste_calculations_waste_pct ON public.roof_waste_calculations(waste_percentage);

-- Add trigger for updated_at
CREATE TRIGGER update_roof_facets_updated_at
  BEFORE UPDATE ON public.roof_facets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();