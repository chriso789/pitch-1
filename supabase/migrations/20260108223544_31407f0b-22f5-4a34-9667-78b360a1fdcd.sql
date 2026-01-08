-- Fix foreign key on roof_training_sessions.ai_measurement_id
-- Change from referencing roof_measurements to measurements table

ALTER TABLE roof_training_sessions 
DROP CONSTRAINT IF EXISTS roof_training_sessions_ai_measurement_id_fkey;

ALTER TABLE roof_training_sessions 
ADD CONSTRAINT roof_training_sessions_ai_measurement_id_fkey 
FOREIGN KEY (ai_measurement_id) REFERENCES measurements(id) ON DELETE SET NULL;