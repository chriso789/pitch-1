-- Mirror sms_messages -> communication_history so lead Comms tab sees inbound texts.
-- Backfill any existing sms_messages that have a contact_id but no matching row in communication_history.

CREATE OR REPLACE FUNCTION public.sync_sms_message_to_communication_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only mirror messages tied to a contact (orphans live in unmatched_inbound)
  IF NEW.contact_id IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Avoid duplicates if a separate writer already inserted by provider_message_id
  IF NEW.provider_message_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.communication_history
      WHERE tenant_id = NEW.tenant_id
        AND communication_type = 'sms'
        AND message_id = NEW.provider_message_id
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.communication_history (
    tenant_id, contact_id, communication_type, direction,
    content, delivery_status, from_address, to_address,
    message_id, thread_id, created_at, updated_at
  ) VALUES (
    NEW.tenant_id,
    NEW.contact_id,
    'sms',
    NEW.direction,
    NEW.body,
    NEW.status,
    NEW.from_number,
    NEW.to_number,
    NEW.provider_message_id,
    NEW.thread_id::text,
    COALESCE(NEW.created_at, now()),
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sms_to_comm_history ON public.sms_messages;
CREATE TRIGGER trg_sync_sms_to_comm_history
AFTER INSERT ON public.sms_messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_sms_message_to_communication_history();

-- Backfill: copy any sms_messages with a contact_id that aren't already in communication_history.
INSERT INTO public.communication_history (
  tenant_id, contact_id, communication_type, direction,
  content, delivery_status, from_address, to_address,
  message_id, thread_id, created_at, updated_at
)
SELECT
  m.tenant_id, m.contact_id, 'sms', m.direction,
  m.body, m.status, m.from_number, m.to_number,
  m.provider_message_id, m.thread_id::text,
  COALESCE(m.created_at, now()), now()
FROM public.sms_messages m
WHERE m.contact_id IS NOT NULL
  AND m.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.communication_history c
    WHERE c.tenant_id = m.tenant_id
      AND c.communication_type = 'sms'
      AND (
        (m.provider_message_id IS NOT NULL AND c.message_id = m.provider_message_id)
        OR (
          c.contact_id = m.contact_id
          AND c.direction = m.direction
          AND c.content IS NOT DISTINCT FROM m.body
          AND abs(extract(epoch FROM (c.created_at - m.created_at))) < 5
        )
      )
  );