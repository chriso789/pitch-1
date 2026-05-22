CREATE OR REPLACE FUNCTION public.claim_sms_blast_items(p_blast_id uuid, p_limit integer)
 RETURNS SETOF sms_blast_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      ORDER BY updated_at, id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING i.*;
END;
$function$;