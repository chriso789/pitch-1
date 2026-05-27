
ALTER TABLE public.srs_order_status_history
  ADD COLUMN IF NOT EXISTS srs_event_id text,
  ADD COLUMN IF NOT EXISTS srs_event_type text;

CREATE UNIQUE INDEX IF NOT EXISTS srs_order_status_history_event_uidx
  ON public.srs_order_status_history (order_id, srs_event_id)
  WHERE srs_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS srs_order_status_history_event_type_idx
  ON public.srs_order_status_history (srs_event_type);
