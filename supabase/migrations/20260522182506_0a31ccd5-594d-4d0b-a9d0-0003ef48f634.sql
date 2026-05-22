
-- 1. Unstick the wedged blast
UPDATE public.sms_blast_items
   SET status = 'pending',
       claimed_at = NULL,
       updated_at = now()
 WHERE blast_id = '246b4fef-ae43-4631-a7fe-8a93b34d20f7'
   AND status = 'claimed'
   AND sent_at IS NULL
   AND telnyx_message_id IS NULL;

-- Also flip the parent blast back to draft-ready state so the processor picks it up
UPDATE public.sms_blasts
   SET status = 'sending',
       updated_at = now()
 WHERE id = '246b4fef-ae43-4631-a7fe-8a93b34d20f7';

-- 2. Stale-claim recovery in the claim function
CREATE OR REPLACE FUNCTION public.claim_sms_blast_items(p_blast_id uuid, p_limit integer)
 RETURNS SETOF public.sms_blast_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.sms_blast_items i
     SET status = 'claimed',
         claimed_at = now(),
         attempt_count = COALESCE(i.attempt_count, 0) + 1,
         updated_at = now()
   WHERE i.id IN (
     SELECT id FROM public.sms_blast_items
      WHERE blast_id = p_blast_id
        AND (
          status = 'pending'
          OR (
            status = 'claimed'
            AND sent_at IS NULL
            AND telnyx_message_id IS NULL
            AND claimed_at < now() - interval '5 minutes'
          )
        )
      ORDER BY updated_at, id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING i.*;
END;
$function$;
