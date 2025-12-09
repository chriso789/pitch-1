-- Drop the existing check constraint
ALTER TABLE session_activity_log 
DROP CONSTRAINT IF EXISTS session_activity_log_event_type_check;

-- Add new constraint with additional event types
ALTER TABLE session_activity_log 
ADD CONSTRAINT session_activity_log_event_type_check 
CHECK (event_type = ANY (ARRAY[
  'login_success'::text, 
  'login_failed'::text, 
  'logout'::text, 
  'session_refresh'::text, 
  'password_reset_request'::text,
  'company_switch'::text,
  'password_reset_complete'::text,
  'page_navigation'::text
]));