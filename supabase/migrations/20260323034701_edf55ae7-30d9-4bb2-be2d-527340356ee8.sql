ALTER TABLE ai_answering_config
ADD COLUMN IF NOT EXISTS auto_create_leads boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_schedule_appointments boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS sms_notify_rep boolean DEFAULT true;