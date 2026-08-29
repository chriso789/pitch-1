ALTER TABLE public.quote_tracking_links
  ADD COLUMN IF NOT EXISTS email_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_open_count integer NOT NULL DEFAULT 0;