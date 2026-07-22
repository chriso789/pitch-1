
ALTER TABLE public.sms_blast_items DROP CONSTRAINT IF EXISTS sms_blast_items_status_check;
ALTER TABLE public.sms_blast_items
  ADD CONSTRAINT sms_blast_items_status_check
  CHECK (status = ANY (ARRAY[
    'pending','claimed','sent','delivered','replied','failed','opted_out',
    'cancelled','skipped_cooldown','skipped_duplicate','skipped_landline',
    'skipped_missing_address','skipped_opt_out','quarantined','retry_pending'
  ]));

NOTIFY pgrst, 'reload schema';
