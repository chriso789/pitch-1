ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'rank_change','achievement_unlock','prize_zone','reward_ready',
    'signature_received','envelope_completed','envelope_viewed',
    'mention','lead_hot','estimate_viewed','proposal_signed',
    'appointment_scheduled','deal_closed','security_alert',
    'quote_viewed'
  ]));