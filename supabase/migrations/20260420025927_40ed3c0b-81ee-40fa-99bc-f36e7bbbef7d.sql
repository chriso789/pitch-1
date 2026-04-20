-- Phase 2: Extensions, helper, triggers
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Central helper used by all event-emitting triggers.
-- Inserts into domain_events (dedupe-safe) and pings the dispatcher.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_company_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_parent_entity_type text DEFAULT NULL,
  p_parent_entity_id uuid DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_entity_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.domain_events (
    company_id, event_type, entity_type, entity_id,
    parent_entity_type, parent_entity_id,
    payload, dedupe_key, actor_user_id, source, occurred_at
  ) VALUES (
    p_company_id, p_event_type, p_entity_type, p_entity_id,
    p_parent_entity_type, p_parent_entity_id,
    COALESCE(p_payload, '{}'::jsonb), p_dedupe_key, p_actor_user_id, 'trigger', now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Never fail the parent transaction over an event-emit problem.
  RAISE WARNING '[emit_domain_event] failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_domain_event(uuid,text,text,uuid,jsonb,text,text,uuid,uuid) FROM PUBLIC;

-- ===========================================================================
-- TRIGGER: pipeline_entries  ->  lead.status_changed
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_pipeline_entries_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id,
      'lead.status_changed',
      'pipeline_entry',
      NEW.id,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'contact_id', NEW.contact_id
      ),
      'pipeline_entry.status:' || NEW.id::text || ':' || COALESCE(NEW.status,'') || ':' || extract(epoch from now())::bigint::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_entries_emit_events ON public.pipeline_entries;
CREATE TRIGGER pipeline_entries_emit_events
AFTER UPDATE ON public.pipeline_entries
FOR EACH ROW EXECUTE FUNCTION public.tg_pipeline_entries_emit_events();

-- ===========================================================================
-- TRIGGER: jobs -> job.created, job.status_changed
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_jobs_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id,
      'job.created',
      'job',
      NEW.id,
      jsonb_build_object(
        'status', NEW.status,
        'contact_id', NEW.contact_id,
        'project_id', NEW.project_id,
        'pipeline_entry_id', NEW.pipeline_entry_id
      ),
      'job.created:' || NEW.id::text
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id,
      'job.status_changed',
      'job',
      NEW.id,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'contact_id', NEW.contact_id,
        'project_id', NEW.project_id
      ),
      'job.status:' || NEW.id::text || ':' || COALESCE(NEW.status,'') || ':' || extract(epoch from now())::bigint::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_emit_events ON public.jobs;
CREATE TRIGGER jobs_emit_events
AFTER INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_emit_events();

-- ===========================================================================
-- TRIGGER: estimates -> estimate.sent / estimate.approved / estimate.rejected
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_estimates_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id,
      'estimate.sent',
      'estimate',
      NEW.id,
      jsonb_build_object('pipeline_entry_id', NEW.pipeline_entry_id, 'project_id', NEW.project_id),
      'estimate.sent:' || NEW.id::text
    );
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    IF NEW.status::text = 'approved' THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'estimate.approved', 'estimate', NEW.id,
        jsonb_build_object('pipeline_entry_id', NEW.pipeline_entry_id),
        'estimate.approved:' || NEW.id::text
      );
    ELSIF NEW.status::text = 'rejected' THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'estimate.rejected', 'estimate', NEW.id,
        jsonb_build_object('pipeline_entry_id', NEW.pipeline_entry_id),
        'estimate.rejected:' || NEW.id::text
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimates_emit_events ON public.estimates;
CREATE TRIGGER estimates_emit_events
AFTER UPDATE ON public.estimates
FOR EACH ROW EXECUTE FUNCTION public.tg_estimates_emit_events();

-- ===========================================================================
-- TRIGGER: communication_history -> communication.* events
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_comms_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  v_event := CASE
    WHEN NEW.communication_type = 'sms'   AND NEW.direction = 'inbound'  THEN 'communication.inbound_sms'
    WHEN NEW.communication_type = 'sms'   AND NEW.direction = 'outbound' THEN 'communication.outbound_sms'
    WHEN NEW.communication_type = 'email' AND NEW.direction = 'inbound'  THEN 'communication.inbound_email'
    WHEN NEW.communication_type = 'email' AND NEW.direction = 'outbound' THEN 'communication.outbound_email'
    WHEN NEW.communication_type = 'call'                                  THEN 'communication.call_completed'
    ELSE NULL
  END;

  IF v_event IS NULL THEN RETURN NEW; END IF;

  PERFORM public.emit_domain_event(
    NEW.tenant_id,
    v_event,
    'communication',
    NEW.id,
    jsonb_build_object(
      'contact_id', NEW.contact_id,
      'pipeline_entry_id', NEW.pipeline_entry_id,
      'project_id', NEW.project_id,
      'communication_type', NEW.communication_type,
      'direction', NEW.direction
    ),
    'comm:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS communication_history_emit_events ON public.communication_history;
CREATE TRIGGER communication_history_emit_events
AFTER INSERT ON public.communication_history
FOR EACH ROW EXECUTE FUNCTION public.tg_comms_emit_events();

-- ===========================================================================
-- TRIGGER: project_invoices -> invoice.created / invoice.overdue
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_project_invoices_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'invoice.created', 'invoice', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'pipeline_entry_id', NEW.pipeline_entry_id),
      'invoice.created:' || NEW.id::text
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'overdue' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'invoice.overdue', 'invoice', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'pipeline_entry_id', NEW.pipeline_entry_id),
      'invoice.overdue:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_invoices_emit_events ON public.project_invoices;
CREATE TRIGGER project_invoices_emit_events
AFTER INSERT OR UPDATE ON public.project_invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_project_invoices_emit_events();

-- ===========================================================================
-- TRIGGER: project_payments -> payment.received
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_project_payments_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'payment.received', 'payment', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'pipeline_entry_id', NEW.pipeline_entry_id),
      'payment.received:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_payments_emit_events ON public.project_payments;
CREATE TRIGGER project_payments_emit_events
AFTER INSERT ON public.project_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_project_payments_emit_events();

-- ===========================================================================
-- TRIGGER: agreement_instances -> contract.signed
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_agreements_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'completed' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'contract.signed', 'agreement', NEW.id,
      jsonb_build_object(
        'contact_id', NEW.contact_id,
        'pipeline_entry_id', NEW.pipeline_entry_id,
        'project_id', NEW.project_id,
        'template_slug', NEW.template_slug
      ),
      'contract.signed:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agreement_instances_emit_events ON public.agreement_instances;
CREATE TRIGGER agreement_instances_emit_events
AFTER UPDATE ON public.agreement_instances
FOR EACH ROW EXECUTE FUNCTION public.tg_agreements_emit_events();