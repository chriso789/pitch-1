
-- Extend sms_blasts with throughput + outcome fields
ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS target_window_minutes int DEFAULT 30,
  ADD COLUMN IF NOT EXISTS required_messages_per_second numeric,
  ADD COLUMN IF NOT EXISTS actual_messages_per_second numeric,
  ADD COLUMN IF NOT EXISTS last_processor_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reply_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS delivered_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replied_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_test_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS from_location_id uuid;

-- Widen status check on blasts to allow 'failed' and 'paused'
ALTER TABLE public.sms_blasts DROP CONSTRAINT IF EXISTS sms_blasts_status_check;
ALTER TABLE public.sms_blasts
  ADD CONSTRAINT sms_blasts_status_check
  CHECK (status = ANY (ARRAY['draft','sending','paused','completed','cancelled','failed']));

-- Extend sms_blast_items with claim + delivery state
ALTER TABLE public.sms_blast_items
  ADD COLUMN IF NOT EXISTS telnyx_message_id text,
  ADD COLUMN IF NOT EXISTS from_number text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count int DEFAULT 0;

-- Widen status check on items to include 'claimed','delivered','replied'
ALTER TABLE public.sms_blast_items DROP CONSTRAINT IF EXISTS sms_blast_items_status_check;
ALTER TABLE public.sms_blast_items
  ADD CONSTRAINT sms_blast_items_status_check
  CHECK (status = ANY (ARRAY['pending','claimed','sent','delivered','replied','failed','opted_out','cancelled']));

CREATE UNIQUE INDEX IF NOT EXISTS sms_blast_items_telnyx_msg_uq
  ON public.sms_blast_items(telnyx_message_id) WHERE telnyx_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_blast_items_blast_status_idx
  ON public.sms_blast_items(blast_id, status);

-- locations: per-number messaging throughput / limits
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS messages_per_second numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS telnyx_phone_number_id text,
  ADD COLUMN IF NOT EXISTS supports_sms boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_voice boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS current_day_sent int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_day_reset_at date,
  ADD COLUMN IF NOT EXISTS daily_limit int DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS tendlc_campaign_status text;

-- sms_messages: link rows back to a blast
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS blast_id uuid REFERENCES public.sms_blasts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blast_item_id uuid REFERENCES public.sms_blast_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sms_messages_blast_id_idx ON public.sms_messages(blast_id);
CREATE INDEX IF NOT EXISTS sms_messages_telnyx_message_id_idx ON public.sms_messages(telnyx_message_id) WHERE telnyx_message_id IS NOT NULL;

-- Atomic claim RPC for the blast worker
CREATE OR REPLACE FUNCTION public.claim_sms_blast_items(p_blast_id uuid, p_limit int)
RETURNS SETOF public.sms_blast_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.sms_blast_items i
     SET status = 'claimed',
         claimed_at = now(),
         attempt_count = COALESCE(i.attempt_count,0) + 1
   WHERE i.id IN (
     SELECT id FROM public.sms_blast_items
      WHERE blast_id = p_blast_id
        AND status = 'pending'
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING i.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sms_blast_items(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_sms_blast_items(uuid, int) TO service_role;

-- pg_cron schedule for the blast processor (every minute)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    PERFORM cron.unschedule('sms-blast-processor-every-minute')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sms-blast-processor-every-minute');

    PERFORM cron.schedule(
      'sms-blast-processor-every-minute',
      '* * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/sms-blast-processor',
          headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer ' || current_setting('app.service_role_key', true)
          ),
          body := jsonb_build_object('source','cron')
        );
      $cron$
    );
  END IF;
END $$;
