UPDATE public.sms_blast_items
   SET status = 'pending',
       sent_at = NULL,
       delivered_at = NULL,
       replied_at = NULL,
       telnyx_message_id = NULL,
       from_number = NULL,
       claimed_at = NULL,
       last_error = NULL,
       error_message = NULL,
       updated_at = now()
 WHERE id = '8272b84b-c6ae-467c-b79c-74ae4552f384'
   AND blast_id = '246b4fef-ae43-4631-a7fe-8a93b34d20f7'
   AND status = 'skipped_cooldown';

UPDATE public.sms_blasts
   SET status = 'draft',
       is_test_mode = true,
       sent_count = 0,
       failed_count = 0,
       opted_out_count = 0,
       delivered_count = 0,
       replied_count = 0,
       failure_rate = 0,
       delivery_rate = 0,
       reply_rate = 0,
       completed_at = NULL,
       cancelled_at = NULL,
       cancel_reason = NULL,
       last_processor_run_at = NULL,
       updated_at = now()
 WHERE id = '246b4fef-ae43-4631-a7fe-8a93b34d20f7';