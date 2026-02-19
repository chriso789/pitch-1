-- Fix: Add 'admin' to the allowed session_type values
ALTER TABLE ai_chat_sessions DROP CONSTRAINT IF EXISTS ai_chat_sessions_session_type_check;
ALTER TABLE ai_chat_sessions ADD CONSTRAINT ai_chat_sessions_session_type_check 
  CHECK (session_type = ANY (ARRAY['general', 'lead_assist', 'task_planning', 'pipeline_review', 'admin']));