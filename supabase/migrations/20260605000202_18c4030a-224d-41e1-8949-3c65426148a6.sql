-- Re-scope mislabeled SMS blasts: if every recipient belongs to a single location
-- different from from_location_id, reassign from_location_id to match recipients.
WITH recipient_locs AS (
  SELECT bi.blast_id,
         array_agg(DISTINCT c.location_id) FILTER (WHERE c.location_id IS NOT NULL) AS loc_ids
  FROM public.sms_blast_items bi
  JOIN public.contacts c ON c.id = bi.contact_id
  GROUP BY bi.blast_id
)
UPDATE public.sms_blasts b
SET from_location_id = (rl.loc_ids)[1]
FROM recipient_locs rl
WHERE b.id = rl.blast_id
  AND array_length(rl.loc_ids, 1) = 1
  AND (b.from_location_id IS DISTINCT FROM (rl.loc_ids)[1]);