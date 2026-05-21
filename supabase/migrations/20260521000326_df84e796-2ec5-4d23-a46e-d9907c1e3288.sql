
-- 1. Add pipeline_entry_id to sms_threads and sms_messages
ALTER TABLE public.sms_threads
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid;

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid;

CREATE INDEX IF NOT EXISTS idx_sms_threads_pipeline_entry
  ON public.sms_threads(pipeline_entry_id);

CREATE INDEX IF NOT EXISTS idx_sms_messages_pipeline_entry
  ON public.sms_messages(pipeline_entry_id);

-- 2. Update the mirror trigger to carry pipeline_entry_id into communication_history
CREATE OR REPLACE FUNCTION public.sync_sms_message_to_communication_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_entry_id uuid;
BEGIN
  IF NEW.contact_id IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

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

  -- Prefer the message's own pipeline_entry_id, otherwise inherit from the thread
  v_pipeline_entry_id := NEW.pipeline_entry_id;
  IF v_pipeline_entry_id IS NULL AND NEW.thread_id IS NOT NULL THEN
    SELECT pipeline_entry_id INTO v_pipeline_entry_id
    FROM public.sms_threads
    WHERE id = NEW.thread_id;
  END IF;

  INSERT INTO public.communication_history (
    tenant_id, contact_id, pipeline_entry_id, communication_type, direction,
    content, delivery_status, from_address, to_address,
    message_id, thread_id, created_at, updated_at
  ) VALUES (
    NEW.tenant_id,
    NEW.contact_id,
    v_pipeline_entry_id,
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

-- 3. Backfill pipeline_entry_id on existing sms_threads using the most recent
--    outbound communication_history row for the same contact.
UPDATE public.sms_threads t
SET pipeline_entry_id = ch.pipeline_entry_id
FROM (
  SELECT DISTINCT ON (tenant_id, contact_id)
    tenant_id, contact_id, pipeline_entry_id, created_at
  FROM public.communication_history
  WHERE communication_type = 'sms'
    AND direction = 'outbound'
    AND pipeline_entry_id IS NOT NULL
    AND contact_id IS NOT NULL
  ORDER BY tenant_id, contact_id, created_at DESC
) ch
WHERE t.pipeline_entry_id IS NULL
  AND t.tenant_id = ch.tenant_id
  AND t.contact_id = ch.contact_id;

-- 4. Backfill pipeline_entry_id on existing sms_messages from their thread
UPDATE public.sms_messages m
SET pipeline_entry_id = t.pipeline_entry_id
FROM public.sms_threads t
WHERE m.pipeline_entry_id IS NULL
  AND m.thread_id = t.id
  AND t.pipeline_entry_id IS NOT NULL;

-- 5. Backfill communication_history.pipeline_entry_id for existing SMS rows
--    using the resolved thread pipeline_entry_id (matched by message_id).
UPDATE public.communication_history c
SET pipeline_entry_id = m.pipeline_entry_id
FROM public.sms_messages m
WHERE c.pipeline_entry_id IS NULL
  AND c.communication_type = 'sms'
  AND c.message_id IS NOT NULL
  AND m.provider_message_id = c.message_id
  AND m.pipeline_entry_id IS NOT NULL;
