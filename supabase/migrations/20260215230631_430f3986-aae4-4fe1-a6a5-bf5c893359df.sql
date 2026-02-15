ALTER TABLE storm_properties_public
  ADD COLUMN IF NOT EXISTS storm_event_id TEXT,
  ADD COLUMN IF NOT EXISTS polygon_id TEXT;