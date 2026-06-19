
-- ============ Labor Order Status System ============
CREATE TABLE IF NOT EXISTS public.labor_order_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  requires_date BOOLEAN NOT NULL DEFAULT false,
  triggers_notification BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_order_statuses TO authenticated;
GRANT ALL ON public.labor_order_statuses TO service_role;
ALTER TABLE public.labor_order_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labor_order_statuses tenant select"
ON public.labor_order_statuses FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
       OR tenant_id IN (SELECT tenant_id FROM public.crews WHERE user_id = auth.uid()));

CREATE POLICY "labor_order_statuses tenant manage"
ON public.labor_order_statuses FOR ALL TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS labor_order_statuses_tenant_idx ON public.labor_order_statuses(tenant_id, sort_order);

-- ============ Checklist Items ============
CREATE TABLE IF NOT EXISTS public.labor_order_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status_id UUID NOT NULL REFERENCES public.labor_order_statuses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_order_checklist_items TO authenticated;
GRANT ALL ON public.labor_order_checklist_items TO service_role;
ALTER TABLE public.labor_order_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labor_order_checklist_items select"
ON public.labor_order_checklist_items FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
       OR tenant_id IN (SELECT tenant_id FROM public.crews WHERE user_id = auth.uid()));

CREATE POLICY "labor_order_checklist_items manage"
ON public.labor_order_checklist_items FOR ALL TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- ============ Checklist Completions ============
CREATE TABLE IF NOT EXISTS public.labor_order_checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES public.production_order_assignments(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.labor_order_checklist_items(id) ON DELETE CASCADE,
  completed_by UUID,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(assignment_id, item_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_order_checklist_completions TO authenticated;
GRANT ALL ON public.labor_order_checklist_completions TO service_role;
ALTER TABLE public.labor_order_checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checklist_completions select"
ON public.labor_order_checklist_completions FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
       OR tenant_id IN (SELECT tenant_id FROM public.crews WHERE user_id = auth.uid()));

CREATE POLICY "checklist_completions write"
ON public.labor_order_checklist_completions FOR ALL TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
       OR tenant_id IN (SELECT tenant_id FROM public.crews WHERE user_id = auth.uid()))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
       OR tenant_id IN (SELECT tenant_id FROM public.crews WHERE user_id = auth.uid()));

-- ============ Seed defaults per tenant ============
CREATE OR REPLACE FUNCTION public.seed_labor_order_statuses(p_tenant UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  defaults JSONB := '[
    {"key":"assigned","label":"Assigned","color":"#6b7280","sort":10,"terminal":false,"date":false,"notify":false},
    {"key":"scheduled","label":"Scheduled","color":"#3b82f6","sort":20,"terminal":false,"date":true,"notify":true},
    {"key":"in_progress","label":"In Progress","color":"#f59e0b","sort":30,"terminal":false,"date":false,"notify":false},
    {"key":"on_hold","label":"On Hold","color":"#a16207","sort":40,"terminal":false,"date":false,"notify":false},
    {"key":"completed","label":"Completed","color":"#16a34a","sort":50,"terminal":true,"date":false,"notify":false},
    {"key":"cancelled","label":"Cancelled","color":"#dc2626","sort":60,"terminal":true,"date":false,"notify":false}
  ]'::jsonb;
  rec JSONB;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(defaults) LOOP
    INSERT INTO public.labor_order_statuses(tenant_id, key, label, color, sort_order, is_terminal, requires_date, triggers_notification)
    VALUES (p_tenant, rec->>'key', rec->>'label', rec->>'color', (rec->>'sort')::int, (rec->>'terminal')::bool, (rec->>'date')::bool, (rec->>'notify')::bool)
    ON CONFLICT (tenant_id, key) DO NOTHING;
  END LOOP;
END;
$$;

-- seed for all existing tenants
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_labor_order_statuses(t.id);
  END LOOP;
END $$;

-- auto-seed for new tenants
CREATE OR REPLACE FUNCTION public.trg_seed_labor_order_statuses()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.seed_labor_order_statuses(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seed_labor_order_statuses_after_tenant ON public.tenants;
CREATE TRIGGER seed_labor_order_statuses_after_tenant
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_labor_order_statuses();

-- ============ Notification trigger (calls edge function) ============
CREATE OR REPLACE FUNCTION public.trg_labor_order_schedule_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  should_notify boolean := false;
BEGIN
  IF NEW.order_type <> 'labor' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'scheduled' AND NEW.scheduled_date IS NOT NULL THEN
    should_notify := true;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.status = 'scheduled' AND NEW.scheduled_date IS NOT NULL)
       AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date) THEN
      should_notify := true;
    END IF;
  END IF;

  IF should_notify THEN
    PERFORM net.http_post(
      url := 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/notify-labor-order-scheduled',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('assignment_id', NEW.id, 'tenant_id', NEW.tenant_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS labor_order_schedule_notify ON public.production_order_assignments;
CREATE TRIGGER labor_order_schedule_notify
AFTER INSERT OR UPDATE ON public.production_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_labor_order_schedule_notify();

NOTIFY pgrst, 'reload schema';
