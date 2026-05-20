ALTER TABLE public.srs_orders DROP CONSTRAINT IF EXISTS srs_orders_status_check;
ALTER TABLE public.srs_orders ADD CONSTRAINT srs_orders_status_check
  CHECK (status = ANY (ARRAY[
    'draft','queued','submitted','accepted','confirmed','processing',
    'shipped','delivered','cancelled','error','rejected_by_srs'
  ]));