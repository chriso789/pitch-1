ALTER TABLE ai_answering_config
ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;