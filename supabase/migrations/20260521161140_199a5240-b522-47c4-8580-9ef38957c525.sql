
ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.sms_blast_items
  ADD COLUMN IF NOT EXISTS address_street_snapshot text,
  ADD COLUMN IF NOT EXISTS address_city_snapshot text,
  ADD COLUMN IF NOT EXISTS address_state_snapshot text,
  ADD COLUMN IF NOT EXISTS address_zip_snapshot text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sms_blasts_goal ON public.sms_blasts(goal);
CREATE INDEX IF NOT EXISTS idx_sms_blasts_status ON public.sms_blasts(status);
CREATE INDEX IF NOT EXISTS idx_sms_blast_items_status ON public.sms_blast_items(status);
CREATE INDEX IF NOT EXISTS idx_sms_blast_items_phone ON public.sms_blast_items(phone);
CREATE INDEX IF NOT EXISTS idx_sms_blast_items_sent_at ON public.sms_blast_items(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_blast_id ON public.sms_messages(blast_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_blast_item_id ON public.sms_messages(blast_item_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_from_number ON public.sms_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_to_number ON public.sms_messages(to_number);
CREATE INDEX IF NOT EXISTS idx_sms_templates_goal ON public.sms_templates(goal);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_sms_blasts_touch ON public.sms_blasts;
CREATE TRIGGER trg_sms_blasts_touch BEFORE UPDATE ON public.sms_blasts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_sms_blast_items_touch ON public.sms_blast_items;
CREATE TRIGGER trg_sms_blast_items_touch BEFORE UPDATE ON public.sms_blast_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
