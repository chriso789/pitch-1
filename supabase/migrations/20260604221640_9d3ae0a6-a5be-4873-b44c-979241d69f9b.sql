
ALTER TABLE public.sms_blasts
  ADD COLUMN IF NOT EXISTS parent_blast_id uuid REFERENCES public.sms_blasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_blasts_parent_blast_id ON public.sms_blasts(parent_blast_id);

CREATE OR REPLACE FUNCTION public.recalc_sms_blast_counts(p_blast_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sms_blasts b
  SET
    sent_count      = COALESCE(c.sent_count, 0),
    delivered_count = COALESCE(c.delivered_count, 0),
    replied_count   = COALESCE(c.replied_count, 0),
    opted_out_count = COALESCE(c.opted_out_count, 0),
    failed_count    = COALESCE(c.failed_count, 0),
    updated_at      = now()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','replied'))             AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','replied'))                    AS delivered_count,
      COUNT(*) FILTER (WHERE status = 'replied')                                    AS replied_count,
      COUNT(*) FILTER (WHERE status = 'opted_out')                                  AS opted_out_count,
      COUNT(*) FILTER (WHERE status IN ('failed','cancelled','skipped_cooldown','skipped_duplicate','skipped_missing_address','skipped_opt_out')) AS failed_count
    FROM public.sms_blast_items
    WHERE blast_id = p_blast_id
  ) c
  WHERE b.id = p_blast_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sms_blast_items_recalc_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_sms_blast_counts(OLD.blast_id);
    RETURN OLD;
  END IF;
  PERFORM public.recalc_sms_blast_counts(NEW.blast_id);
  IF TG_OP = 'UPDATE' AND OLD.blast_id IS DISTINCT FROM NEW.blast_id THEN
    PERFORM public.recalc_sms_blast_counts(OLD.blast_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_blast_items_recalc ON public.sms_blast_items;
CREATE TRIGGER sms_blast_items_recalc
AFTER INSERT OR UPDATE OF status OR DELETE ON public.sms_blast_items
FOR EACH ROW EXECUTE FUNCTION public.sms_blast_items_recalc_trg();

-- Backfill: for historical inbound replies that didn't update items, mark the most
-- recent matching item as replied (or opted_out for STOP keywords), then recompute counters.
WITH stop_words AS (
  SELECT unnest(ARRAY['STOP','UNSUBSCRIBE','CANCEL','END','QUIT','STOPALL']) AS w
),
inbound AS (
  SELECT
    m.tenant_id,
    m.from_number,
    regexp_replace(m.from_number, '\D', '', 'g') AS digits,
    right(regexp_replace(m.from_number, '\D', '', 'g'), 10) AS last10,
    upper(trim(m.body)) AS body_upper,
    m.created_at
  FROM public.sms_messages m
  WHERE m.direction = 'inbound'
),
matches AS (
  SELECT DISTINCT ON (i.id)
    i.id AS item_id,
    inb.body_upper,
    inb.created_at
  FROM public.sms_blast_items i
  JOIN inbound inb
    ON inb.tenant_id = i.tenant_id
   AND (i.phone = inb.from_number
        OR i.phone = inb.digits
        OR i.phone = inb.last10
        OR i.phone = '+' || inb.digits
        OR i.phone = '1' || inb.last10)
  WHERE i.status IN ('sent','delivered')
  ORDER BY i.id, inb.created_at DESC
)
UPDATE public.sms_blast_items i
SET
  status = CASE WHEN m.body_upper IN (SELECT w FROM stop_words) THEN 'opted_out' ELSE 'replied' END,
  replied_at = CASE WHEN m.body_upper IN (SELECT w FROM stop_words) THEN i.replied_at ELSE COALESCE(i.replied_at, m.created_at) END
FROM matches m
WHERE i.id = m.item_id;

-- Recompute counters on every blast
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sms_blasts LOOP
    PERFORM public.recalc_sms_blast_counts(r.id);
  END LOOP;
END $$;
