ALTER TABLE public.sms_blast_items
  DROP CONSTRAINT IF EXISTS sms_blast_items_status_check;

ALTER TABLE public.sms_blast_items
  ADD CONSTRAINT sms_blast_items_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'claimed'::text,
    'sent'::text,
    'delivered'::text,
    'replied'::text,
    'failed'::text,
    'opted_out'::text,
    'cancelled'::text,
    'skipped_cooldown'::text,
    'skipped_duplicate'::text
  ]));

UPDATE public.sms_blast_items
   SET status = 'skipped_cooldown',
       claimed_at = NULL,
       last_error = 'per_phone_24h_cooldown',
       error_message = 'Skipped: already messaged this phone in last 24h',
       updated_at = now()
 WHERE id = '8272b84b-c6ae-467c-b79c-74ae4552f384'
   AND status = 'claimed'
   AND sent_at IS NULL
   AND telnyx_message_id IS NULL;

UPDATE public.sms_blasts b
   SET status = 'completed',
       completed_at = COALESCE(completed_at, now()),
       sent_count = COALESCE((
         SELECT count(*)::int
         FROM public.sms_blast_items i
         WHERE i.blast_id = b.id
           AND i.status IN ('sent', 'delivered', 'replied')
       ), 0),
       delivered_count = COALESCE((
         SELECT count(*)::int
         FROM public.sms_blast_items i
         WHERE i.blast_id = b.id
           AND i.status = 'delivered'
       ), 0),
       replied_count = COALESCE((
         SELECT count(*)::int
         FROM public.sms_blast_items i
         WHERE i.blast_id = b.id
           AND i.status = 'replied'
       ), 0),
       failed_count = COALESCE((
         SELECT count(*)::int
         FROM public.sms_blast_items i
         WHERE i.blast_id = b.id
           AND i.status IN ('failed', 'skipped_cooldown', 'skipped_duplicate')
       ), 0),
       opted_out_count = COALESCE((
         SELECT count(*)::int
         FROM public.sms_blast_items i
         WHERE i.blast_id = b.id
           AND i.status = 'opted_out'
       ), 0),
       last_processor_run_at = now()
 WHERE b.id = '246b4fef-ae43-4631-a7fe-8a93b34d20f7'
   AND NOT EXISTS (
     SELECT 1
     FROM public.sms_blast_items i
     WHERE i.blast_id = b.id
       AND i.status IN ('pending', 'claimed')
   );