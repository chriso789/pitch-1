-- Fix: Add 'vendor_verified' to allowed status values for roof_training_sessions
ALTER TABLE public.roof_training_sessions 
DROP CONSTRAINT IF EXISTS roof_training_sessions_status_check;

ALTER TABLE public.roof_training_sessions 
ADD CONSTRAINT roof_training_sessions_status_check 
CHECK (status IN ('draft', 'in_progress', 'completed', 'reviewed', 'vendor_verified'));