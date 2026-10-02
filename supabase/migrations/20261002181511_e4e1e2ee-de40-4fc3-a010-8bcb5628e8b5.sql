CREATE TABLE public.commercial_vendor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL,
  po_id uuid REFERENCES public.commercial_purchase_orders(id) ON DELETE RESTRICT,
  subcontract_id uuid REFERENCES public.commercial_subcontracts(id) ON DELETE RESTRICT,
  invoice_date date, due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','paid','void')),
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  retainage_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (retainage_pct BETWEEN 0 AND 100),
  retainage_amount numeric(14,2) GENERATED ALWAYS AS (round(gross_amount * retainage_pct / 100, 2)) STORED,
  net_due numeric(14,2) GENERATED ALWAYS AS (gross_amount - round(gross_amount * retainage_pct / 100, 2)) STORED,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_date date, document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT, notes text,
  approved_by uuid, approved_at timestamptz,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (po_id IS NULL OR subcontract_id IS NULL),
  UNIQUE (project_id, vendor_name, invoice_number));

CREATE TABLE public.commercial_vendor_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  invoice_id uuid NOT NULL REFERENCES public.commercial_vendor_invoices(id) ON DELETE RESTRICT,
  cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  cost_type text NOT NULL DEFAULT 'material',
  description text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('labor','equipment','other')),
  cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  cost_type text NOT NULL DEFAULT 'labor',
  work_date date NOT NULL DEFAULT current_date,
  description text NOT NULL,
  resource_name text,
  quantity numeric NOT NULL DEFAULT 1,
  uom text,
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  amount numeric(14,2) GENERATED ALWAYS AS (round(quantity * unit_cost, 2)) STORED,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_vendor_invoices','commercial_vendor_invoice_lines','commercial_cost_entries'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant access" ON public.%I FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY block_deactivated_company ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_login_blocked())) WITH CHECK (NOT (SELECT public.is_login_blocked()))', t);
    EXECUTE format('CREATE POLICY "no deletes" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
    EXECUTE format('CREATE INDEX ON public.%I (tenant_id)', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;
CREATE INDEX ON public.commercial_vendor_invoices(project_id);
CREATE INDEX ON public.commercial_vendor_invoice_lines(invoice_id);
CREATE INDEX ON public.commercial_cost_entries(project_id, work_date);

REVOKE UPDATE ON public.commercial_vendor_invoices FROM authenticated;
GRANT UPDATE (invoice_number, vendor_id, vendor_name, po_id, subcontract_id, invoice_date, due_date, status, retainage_pct, paid_amount, paid_date, document_id, notes) ON public.commercial_vendor_invoices TO authenticated;

-- Unified actuals view
CREATE VIEW public.commercial_actual_costs WITH (security_invoker = true) AS
  SELECT 'invoice'::text AS source, i.id AS source_id, i.invoice_number AS reference, i.tenant_id, i.project_id, i.vendor_name AS party,
    coalesce(i.invoice_date, i.created_at::date) AS cost_date, l.cost_code_id, l.cost_type, l.description, l.amount
  FROM commercial_vendor_invoices i JOIN commercial_vendor_invoice_lines l ON l.invoice_id = i.id AND l.active
  WHERE i.status IN ('approved','paid')
  UNION ALL
  SELECT e.entry_type, e.id, NULL, e.tenant_id, e.project_id, e.resource_name, e.work_date, e.cost_code_id, e.cost_type, e.description, e.amount
  FROM commercial_cost_entries e WHERE e.active;
GRANT SELECT ON public.commercial_actual_costs TO authenticated;

CREATE OR REPLACE FUNCTION public.commercial_recompute_actuals(_project_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE commercial_vendor_invoices i SET gross_amount = coalesce((SELECT sum(amount) FROM commercial_vendor_invoice_lines WHERE invoice_id = i.id AND active), 0)
    WHERE i.project_id = _project_id;
  UPDATE commercial_purchase_orders h SET
    invoiced_amount = coalesce((SELECT sum(gross_amount) FROM commercial_vendor_invoices WHERE po_id = h.id AND status IN ('approved','paid')), 0),
    paid_amount = coalesce((SELECT sum(paid_amount) FROM commercial_vendor_invoices WHERE po_id = h.id AND status IN ('approved','paid')), 0)
    WHERE h.project_id = _project_id;
  UPDATE commercial_subcontracts h SET
    invoiced_amount = coalesce((SELECT sum(gross_amount) FROM commercial_vendor_invoices WHERE subcontract_id = h.id AND status IN ('approved','paid')), 0),
    paid_amount = coalesce((SELECT sum(paid_amount) FROM commercial_vendor_invoices WHERE subcontract_id = h.id AND status IN ('approved','paid')), 0),
    retainage_held = coalesce((SELECT sum(retainage_amount) FROM commercial_vendor_invoices WHERE subcontract_id = h.id AND status IN ('approved','paid')), 0)
    WHERE h.project_id = _project_id;
  UPDATE commercial_budget_lines bl SET
    actual_cost = coalesce((SELECT sum(amount) FROM commercial_actual_costs a WHERE a.project_id = _project_id AND a.cost_type = bl.cost_type AND a.cost_code_id IS NOT DISTINCT FROM bl.cost_code_id), 0)
  WHERE bl.project_id = _project_id AND bl.budget_id IN (SELECT id FROM commercial_project_budgets WHERE project_id = _project_id AND status = 'active');
END $$;
REVOKE ALL ON FUNCTION public.commercial_recompute_actuals(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commercial_vendor_invoice_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE roles text[]; cap numeric; billed numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft'; NEW.gross_amount := 0; NEW.paid_amount := 0;
    RETURN NEW;
  END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'This invoice is void and can no longer change'; END IF;
  IF OLD.status IN ('approved','paid') AND (NEW.po_id IS DISTINCT FROM OLD.po_id OR NEW.subcontract_id IS DISTINCT FROM OLD.subcontract_id OR NEW.retainage_pct IS DISTINCT FROM OLD.retainage_pct OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number) THEN
    RAISE EXCEPTION 'Approved invoices are locked — void and re-enter instead';
  END IF;
  IF NEW.paid_amount < 0 OR NEW.paid_amount > NEW.net_due + 0.005 AND NEW.paid_amount IS DISTINCT FROM OLD.paid_amount THEN
    RAISE EXCEPTION 'Paid amount must be between 0 and the net due';
  END IF;
  IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount AND NEW.status NOT IN ('approved','paid') THEN
    RAISE EXCEPTION 'Approve the invoice before recording payment';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('draft','pending_approval') AND OLD.status IN ('approved','paid') THEN RAISE EXCEPTION 'An approved invoice cannot go back to draft'; END IF;
    IF NEW.status = 'paid' AND OLD.status IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Approve the invoice first'; END IF;
    IF NEW.status = 'approved' AND OLD.status IN ('draft','pending_approval') THEN
      SELECT array_agg(role::text) INTO roles FROM user_roles WHERE user_id = auth.uid() AND (tenant_id = NEW.tenant_id OR role = 'master');
      IF NOT coalesce(roles && ARRAY['master','owner','corporate','office_admin','regional_manager','sales_manager','project_manager'], false) AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Approving needs a manager-level role';
      END IF;
      IF NEW.gross_amount <= 0 THEN RAISE EXCEPTION 'Add invoice lines before approving'; END IF;
      IF NEW.po_id IS NOT NULL THEN
        SELECT revised_amount, invoiced_amount INTO cap, billed FROM commercial_purchase_orders WHERE id = NEW.po_id;
      ELSIF NEW.subcontract_id IS NOT NULL THEN
        SELECT revised_value, invoiced_amount INTO cap, billed FROM commercial_subcontracts WHERE id = NEW.subcontract_id;
      END IF;
      IF cap IS NOT NULL AND billed + NEW.gross_amount > cap + 0.005 THEN
        RAISE EXCEPTION 'This invoice would bill % over the commitment value — process a change order first', round(billed + NEW.gross_amount - cap, 2);
      END IF;
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    END IF;
  END IF;
  IF NEW.status = 'approved' AND NEW.paid_amount >= NEW.net_due AND NEW.net_due > 0 THEN NEW.status := 'paid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_guard BEFORE INSERT OR UPDATE ON public.commercial_vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.commercial_vendor_invoice_guard();

CREATE OR REPLACE FUNCTION public.commercial_vendor_invoice_rollup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount OR NEW.po_id IS DISTINCT FROM OLD.po_id OR NEW.subcontract_id IS DISTINCT FROM OLD.subcontract_id OR NEW.retainage_pct IS DISTINCT FROM OLD.retainage_pct THEN
    PERFORM commercial_recompute_actuals(NEW.project_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER invoice_rollup AFTER UPDATE ON public.commercial_vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.commercial_vendor_invoice_rollup();

CREATE OR REPLACE FUNCTION public.commercial_invoice_line_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text; pid uuid;
BEGIN
  SELECT status, project_id INTO st, pid FROM commercial_vendor_invoices WHERE id = NEW.invoice_id;
  IF TG_WHEN = 'BEFORE' THEN
    IF st NOT IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Lines are locked once the invoice is approved'; END IF;
    RETURN NEW;
  END IF;
  PERFORM commercial_recompute_actuals(pid);
  RETURN NULL;
END $$;
CREATE TRIGGER line_lock BEFORE INSERT OR UPDATE ON public.commercial_vendor_invoice_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_invoice_line_trigger();
CREATE TRIGGER line_rollup AFTER INSERT OR UPDATE ON public.commercial_vendor_invoice_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_invoice_line_trigger();

CREATE OR REPLACE FUNCTION public.commercial_cost_entry_rollup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM commercial_recompute_actuals(NEW.project_id); RETURN NULL; END $$;
CREATE TRIGGER entry_rollup AFTER INSERT OR UPDATE ON public.commercial_cost_entries FOR EACH ROW EXECUTE FUNCTION public.commercial_cost_entry_rollup();