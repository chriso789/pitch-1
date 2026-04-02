
-- 1. Lead Custom Fields table
CREATE TABLE public.lead_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'select', 'checkbox', 'date')),
  options JSONB DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  required BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.lead_custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view custom fields"
  ON public.lead_custom_fields FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can insert custom fields"
  ON public.lead_custom_fields FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can update custom fields"
  ON public.lead_custom_fields FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can delete custom fields"
  ON public.lead_custom_fields FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- 2. Appointment Outcome Types table
CREATE TABLE public.appointment_outcome_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.appointment_outcome_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view outcome types"
  ON public.appointment_outcome_types FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can insert outcome types"
  ON public.appointment_outcome_types FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can update outcome types"
  ON public.appointment_outcome_types FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can delete outcome types"
  ON public.appointment_outcome_types FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- 3. Add outcome_type_id to appointments
ALTER TABLE public.appointments
  ADD COLUMN outcome_type_id UUID REFERENCES public.appointment_outcome_types(id) ON DELETE SET NULL;

-- 4. Appointment History table
CREATE TABLE public.appointment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES public.profiles(id),
  change_type TEXT NOT NULL DEFAULT 'updated' CHECK (change_type IN ('created', 'updated', 'rescheduled', 'cancelled', 'attendee_changed', 'outcome_set')),
  old_values JSONB DEFAULT '{}',
  new_values JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.appointment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view appointment history"
  ON public.appointment_history FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant members can insert appointment history"
  ON public.appointment_history FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

-- Trigger to auto-log appointment changes
CREATE OR REPLACE FUNCTION public.log_appointment_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_change_type TEXT := 'updated';
  v_old_values JSONB := '{}';
  v_new_values JSONB := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_change_type := 'created';
    v_new_values := to_jsonb(NEW);
    INSERT INTO public.appointment_history (appointment_id, tenant_id, changed_by, change_type, new_values)
    VALUES (NEW.id, NEW.tenant_id, NEW.created_by, v_change_type, v_new_values);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.scheduled_start IS DISTINCT FROM NEW.scheduled_start OR OLD.scheduled_end IS DISTINCT FROM NEW.scheduled_end THEN
      v_change_type := 'rescheduled';
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN
      v_change_type := 'cancelled';
    ELSIF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      v_change_type := 'attendee_changed';
    ELSIF OLD.outcome_type_id IS DISTINCT FROM NEW.outcome_type_id THEN
      v_change_type := 'outcome_set';
    END IF;

    v_old_values := to_jsonb(OLD);
    v_new_values := to_jsonb(NEW);

    INSERT INTO public.appointment_history (appointment_id, tenant_id, changed_by, change_type, old_values, new_values)
    VALUES (NEW.id, NEW.tenant_id, auth.uid(), v_change_type, v_old_values, v_new_values);
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_appointment_history
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_appointment_changes();

-- 5. Add show_esign_watermark to smart_doc_templates
ALTER TABLE public.smart_doc_templates
  ADD COLUMN show_esign_watermark BOOLEAN DEFAULT true;

-- 6. Add ical_token to profiles
ALTER TABLE public.profiles
  ADD COLUMN ical_token UUID DEFAULT gen_random_uuid();

-- Create index for ical_token lookups
CREATE INDEX idx_profiles_ical_token ON public.profiles(ical_token) WHERE ical_token IS NOT NULL;

-- Indexes for new tables
CREATE INDEX idx_lead_custom_fields_tenant ON public.lead_custom_fields(tenant_id);
CREATE INDEX idx_appointment_outcome_types_tenant ON public.appointment_outcome_types(tenant_id);
CREATE INDEX idx_appointment_history_appointment ON public.appointment_history(appointment_id);
CREATE INDEX idx_appointment_history_tenant ON public.appointment_history(tenant_id);
