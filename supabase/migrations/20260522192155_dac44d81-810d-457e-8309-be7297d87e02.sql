-- Drop the redundant duplicate trigger (keep trg_sms_to_unified_inbox)
DROP TRIGGER IF EXISTS trg_sync_sms_to_inbox ON public.sms_messages;

-- Dedupe existing unified_inbox SMS rows: keep earliest row per related_message_id
DELETE FROM public.unified_inbox a
USING public.unified_inbox b
WHERE a.channel = 'sms'
  AND b.channel = 'sms'
  AND a.related_message_id = b.related_message_id
  AND a.related_message_id IS NOT NULL
  AND a.ctid > b.ctid;