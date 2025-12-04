-- Add missing metadata column to session_activity_log table
ALTER TABLE session_activity_log 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';