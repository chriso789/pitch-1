
CREATE OR REPLACE FUNCTION public.seed_default_contact_statuses_for_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.contact_statuses (tenant_id, name, key, color, status_order, category, is_active, is_system)
  VALUES
    (NEW.id, 'Qualified',       'qualified',         '#3b82f6', 1, 'disposition', true, true),
    (NEW.id, 'Not Home',        'not_home',          '#6b7280', 2, 'disposition', true, true),
    (NEW.id, 'Interested',      'interested',        '#22c55e', 3, 'disposition', true, true),
    (NEW.id, 'Storm Damage',    'storm_damage',      '#f59e0b', 4, 'disposition', true, true),
    (NEW.id, 'New Roof',        'new_roof',          '#06b6d4', 5, 'disposition', true, true),
    (NEW.id, 'Old Roof',        'old_roof_marketing','#eab308', 6, 'disposition', true, true),
    (NEW.id, 'Callback',        'callback',          '#8b5cf6', 7, 'disposition', true, true),
    (NEW.id, 'Appointment Set', 'appointment_set',   '#10b981', 8, 'disposition', true, true),
    (NEW.id, 'Follow Up',       'follow_up',         '#0ea5e9', 9, 'disposition', true, true),
    (NEW.id, 'Go Back',         'go_back',           '#f59e0b',10, 'disposition', true, true),
    (NEW.id, 'Not Interested',  'not_interested',    '#ef4444',11, 'disposition', true, true),
    (NEW.id, 'Do Not Contact',  'do_not_contact',    '#7f1d1d',12, 'disposition', true, true),
    (NEW.id, 'Past Customer',   'past_customer',     '#14b8a6',13, 'disposition', true, true)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_default_contact_statuses_after_tenant_insert ON public.tenants;
CREATE TRIGGER seed_default_contact_statuses_after_tenant_insert
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.seed_default_contact_statuses_for_tenant();
