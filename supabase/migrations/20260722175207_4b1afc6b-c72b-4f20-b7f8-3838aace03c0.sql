
ALTER TABLE public.sms_blasts DROP CONSTRAINT IF EXISTS sms_blasts_status_check;
ALTER TABLE public.sms_blasts
  ADD CONSTRAINT sms_blasts_status_check
  CHECK (status = ANY (ARRAY[
    'draft','scheduled','sending','paused','completed','completed_with_warnings','cancelled','failed'
  ]));

NOTIFY pgrst, 'reload schema';
