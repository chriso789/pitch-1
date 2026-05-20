
ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS daily_send_limit integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS sent_today_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_window_started_at timestamptz;

ALTER TABLE public.sms_blast_items
  ADD COLUMN IF NOT EXISTS routed_contact_id uuid,
  ADD COLUMN IF NOT EXISTS routing_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS routing_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS routing_confidence text;
