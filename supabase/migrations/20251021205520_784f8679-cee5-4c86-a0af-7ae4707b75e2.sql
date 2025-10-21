-- ============================================================================
-- Building Footprints Cache Table
-- Stores building geometry from Google Solar API and OSM for reuse
-- ============================================================================

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create building footprints cache table
CREATE TABLE IF NOT EXISTS public.building_footprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  geom_geog GEOGRAPHY(POLYGON, 4326),
  
  -- Source and data
  source TEXT NOT NULL CHECK (source IN ('google_solar', 'osm')),
  building_polygon JSONB NOT NULL,
  roof_segments JSONB,
  
  -- Metadata
  imagery_date DATE,
  confidence_score NUMERIC(3,2) DEFAULT 0.95,
  last_verified_at TIMESTAMPTZ DEFAULT now(),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Spatial index for efficient location-based queries
CREATE INDEX IF NOT EXISTS idx_building_footprints_location 
  ON public.building_footprints USING GIST(geom_geog);

-- Index for source filtering
CREATE INDEX IF NOT EXISTS idx_building_footprints_source 
  ON public.building_footprints(source);

-- Enable RLS
ALTER TABLE public.building_footprints ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read cached buildings (public data)
CREATE POLICY "Building footprints are viewable by everyone"
  ON public.building_footprints
  FOR SELECT
  USING (true);

-- Policy: Authenticated users can insert new buildings
CREATE POLICY "Authenticated users can cache buildings"
  ON public.building_footprints
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Helper function: find nearby cached buildings
CREATE OR REPLACE FUNCTION public.nearby_buildings(
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_radius_m INT DEFAULT 10,
  p_max_age_days INT DEFAULT 90
) RETURNS SETOF public.building_footprints AS $$
  SELECT *
  FROM public.building_footprints
  WHERE ST_DWithin(
    geom_geog,
    ST_GeogFromText('POINT(' || p_lng || ' ' || p_lat || ')'),
    p_radius_m
  )
  AND last_verified_at > now() - (p_max_age_days || ' days')::INTERVAL
  ORDER BY last_verified_at DESC
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_building_footprint_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic timestamp updates
CREATE TRIGGER update_building_footprints_updated_at
  BEFORE UPDATE ON public.building_footprints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_building_footprint_timestamp();