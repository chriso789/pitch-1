
ALTER TABLE signature_envelopes 
ADD COLUMN IF NOT EXISTS final_pdf_hash TEXT;

ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_type_check 
  CHECK (type = ANY (ARRAY[
    'rank_change', 'achievement_unlock', 'prize_zone', 'reward_ready',
    'signature_received', 'envelope_completed', 'envelope_viewed'
  ]));
