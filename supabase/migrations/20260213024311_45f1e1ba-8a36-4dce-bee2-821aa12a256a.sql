
-- Add columns to jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS canvass_property_id uuid,
  ADD COLUMN IF NOT EXISTS storm_event_id text;
