CREATE TABLE public.commercial_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  po_number text,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL,
  buyout_package_id uuid REFERENCES public.commercial_buyout_packages(id) ON DELETE RESTRICT,
  bid_quote_id uuid REFERENCES public.commercial_bid_quotes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','issued','partially_received','received','closed','cancelled')),
  original_amount numeric(14,2) NOT NULL DEFAULT 0,
  approved_changes numeric(14,2) NOT NULL DEFAULT 0,
  revised_amount numeric(14,2) GENERATED ALWAYS AS (original_amount + approved_changes) STORED,
  invoiced_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(14,2) GENERATED ALWAYS AS (original_amount + approved_changes - invoiced_amount) STORED,
  issue_date date, required_date date, terms text, shipping_location text, notes text,
  approved_by uuid, approved_at timestamptz,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, po_number));

CREATE TABLE public.commercial_purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  po_id uuid NOT NULL REFERENCES public.commercial_purchase_orders(id) ON DELETE RESTRICT,
  cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  cost_type text NOT NULL DEFAULT 'material',
  description text NOT NULL, quantity numeric NOT NULL DEFAULT 1, uom text, unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  extended_cost numeric(14,2) GENERATED ALWAYS AS (round(quantity * unit_cost, 2)) STORED,
  buyout_package_id uuid REFERENCES public.commercial_buyout_packages(id) ON DELETE RESTRICT,
  estimate_source_id uuid,
  active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_po_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  po_id uuid NOT NULL REFERENCES public.commercial_purchase_orders(id) ON DELETE RESTRICT,
  release_number int NOT NULL, description text, quantity numeric, uom text,
  requested_delivery date, confirmed_delivery date, delivery_address text, site_contact text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','shipped','delivered','received','cancelled')),
  packing_slip_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT, packing_slip text,
  received_quantity numeric, damaged_quantity numeric, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (po_id, release_number));

CREATE TABLE public.commercial_subcontracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  subcontract_number text,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL, scope text,
  buyout_package_id uuid REFERENCES public.commercial_buyout_packages(id) ON DELETE RESTRICT,
  bid_quote_id uuid REFERENCES public.commercial_bid_quotes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','issued','closed','cancelled')),
  contract_value numeric(14,2) NOT NULL DEFAULT 0,
  change_value numeric(14,2) NOT NULL DEFAULT 0,
  revised_value numeric(14,2) GENERATED ALWAYS AS (contract_value + change_value) STORED,
  invoiced_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  retainage_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (retainage_pct >= 0 AND retainage_pct <= 100),
  retainage_held numeric(14,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(14,2) GENERATED ALWAYS AS (contract_value + change_value - invoiced_amount) STORED,
  start_date date, completion_date date, terms text, notes text,
  approved_by uuid, approved_at timestamptz,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, subcontract_number));

CREATE TABLE public.commercial_subcontract_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  subcontract_id uuid NOT NULL REFERENCES public.commercial_subcontracts(id) ON DELETE RESTRICT,
  cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  cost_type text NOT NULL DEFAULT 'subcontract',
  description text NOT NULL, quantity numeric NOT NULL DEFAULT 1, uom text, unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  extended_cost numeric(14,2) GENERATED ALWAYS AS (round(quantity * unit_cost, 2)) STORED,
  buyout_package_id uuid REFERENCES public.commercial_buyout_packages(id) ON DELETE RESTRICT,
  estimate_source_id uuid,
  active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_procurement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  po_id uuid REFERENCES public.commercial_purchase_orders(id) ON DELETE RESTRICT,
  buyout_package_id uuid REFERENCES public.commercial_buyout_packages(id) ON DELETE RESTRICT,
  material text NOT NULL, manufacturer text, supplier_name text,
  submittal_required boolean NOT NULL DEFAULT false,
  required_onsite_date date, quote_date date, po_date date, release_date date, lead_time_days int,
  manufacturing_start_date date, expected_ship_date date, ship_date date, expected_delivery_date date, delivery_date date, received_date date,
  status text NOT NULL DEFAULT 'pricing' CHECK (status IN ('pricing','submittal_required','submittal_pending','approved','ordered','manufacturing','shipped','delivered','complete','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_purchase_orders','commercial_purchase_order_lines','commercial_po_releases','commercial_subcontracts','commercial_subcontract_lines','commercial_procurement_items'] LOOP
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
CREATE INDEX ON public.commercial_purchase_orders(project_id);
CREATE INDEX ON public.commercial_subcontracts(project_id);
CREATE INDEX ON public.commercial_purchase_order_lines(po_id);
CREATE INDEX ON public.commercial_subcontract_lines(subcontract_id);
CREATE INDEX ON public.commercial_procurement_items(project_id);

-- Header money owned by the system: original/contract value come from lines; invoiced/paid/changes from later phases
REVOKE UPDATE ON public.commercial_purchase_orders FROM authenticated;
GRANT UPDATE (vendor_id, contact_id, vendor_name, status, issue_date, required_date, terms, shipping_location, notes) ON public.commercial_purchase_orders TO authenticated;
REVOKE UPDATE ON public.commercial_subcontracts FROM authenticated;
GRANT UPDATE (vendor_id, contact_id, vendor_name, scope, status, retainage_pct, start_date, completion_date, terms, notes) ON public.commercial_subcontracts TO authenticated;

-- Numbering + approval rules on headers
CREATE OR REPLACE FUNCTION public.commercial_commitment_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE roles text[]; prefix text; n int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    IF TG_TABLE_NAME = 'commercial_purchase_orders' THEN
      NEW.original_amount := 0; NEW.approved_changes := 0; NEW.invoiced_amount := 0; NEW.paid_amount := 0;
      IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
        SELECT count(*) + 1 INTO n FROM commercial_purchase_orders WHERE project_id = NEW.project_id;
        NEW.po_number := 'PO-' || lpad(n::text, 3, '0');
      END IF;
    ELSE
      NEW.contract_value := 0; NEW.change_value := 0; NEW.invoiced_amount := 0; NEW.paid_amount := 0; NEW.retainage_held := 0;
      IF NEW.subcontract_number IS NULL OR NEW.subcontract_number = '' THEN
        SELECT count(*) + 1 INTO n FROM commercial_subcontracts WHERE project_id = NEW.project_id;
        NEW.subcontract_number := 'SC-' || lpad(n::text, 3, '0');
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'This commitment is % and can no longer change', OLD.status; END IF;
    IF NEW.status IN ('approved','issued','partially_received','received','closed') AND OLD.status IN ('draft','pending_approval') THEN
      IF NEW.status <> 'approved' THEN RAISE EXCEPTION 'Approve the commitment before moving it to %', NEW.status; END IF;
      SELECT array_agg(role::text) INTO roles FROM user_roles WHERE user_id = auth.uid() AND (tenant_id = NEW.tenant_id OR role = 'master');
      IF NOT coalesce(roles && ARRAY['master','owner','corporate','office_admin','regional_manager','sales_manager','project_manager'], false) AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Approving needs a manager-level role';
      END IF;
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    END IF;
    IF NEW.status IN ('draft','pending_approval') AND OLD.status NOT IN ('draft','pending_approval') THEN
      RAISE EXCEPTION 'An approved commitment cannot go back to draft — use a change order';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commitment_guard BEFORE INSERT OR UPDATE ON public.commercial_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_header_guard();
CREATE TRIGGER commitment_guard BEFORE INSERT OR UPDATE ON public.commercial_subcontracts FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_header_guard();

-- Normalized commitments view
CREATE VIEW public.commercial_commitments WITH (security_invoker = true) AS
  SELECT 'po'::text AS commitment_type, h.id AS commitment_id, h.po_number AS number, h.tenant_id, h.project_id, h.vendor_name, h.status,
    l.id AS line_id, l.cost_code_id, l.cost_type, l.description, coalesce(l.buyout_package_id, h.buyout_package_id) AS buyout_package_id, l.extended_cost AS amount,
    CASE WHEN h.status IN ('draft','pending_approval') THEN 'pending' WHEN h.status = 'cancelled' THEN 'void' ELSE 'committed' END AS bucket
  FROM commercial_purchase_orders h JOIN commercial_purchase_order_lines l ON l.po_id = h.id AND l.active
  UNION ALL
  SELECT 'subcontract', h.id, h.subcontract_number, h.tenant_id, h.project_id, h.vendor_name, h.status,
    l.id, l.cost_code_id, l.cost_type, l.description, coalesce(l.buyout_package_id, h.buyout_package_id), l.extended_cost,
    CASE WHEN h.status IN ('draft','pending_approval') THEN 'pending' WHEN h.status = 'cancelled' THEN 'void' ELSE 'committed' END
  FROM commercial_subcontracts h JOIN commercial_subcontract_lines l ON l.subcontract_id = h.id AND l.active;
GRANT SELECT ON public.commercial_commitments TO authenticated;

-- Deterministic rollup into headers, budget lines and buyout packages
CREATE OR REPLACE FUNCTION public.commercial_recompute_commitments(_project_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE commercial_purchase_orders h SET original_amount = coalesce((SELECT sum(extended_cost) FROM commercial_purchase_order_lines WHERE po_id = h.id AND active), 0)
    WHERE h.project_id = _project_id;
  UPDATE commercial_subcontracts h SET contract_value = coalesce((SELECT sum(extended_cost) FROM commercial_subcontract_lines WHERE subcontract_id = h.id AND active), 0)
    WHERE h.project_id = _project_id;
  UPDATE commercial_budget_lines bl SET
    pending_commitments = coalesce((SELECT sum(amount) FROM commercial_commitments c WHERE c.project_id = _project_id AND c.bucket = 'pending' AND c.cost_type = bl.cost_type AND c.cost_code_id IS NOT DISTINCT FROM bl.cost_code_id), 0),
    committed_cost = coalesce((SELECT sum(amount) FROM commercial_commitments c WHERE c.project_id = _project_id AND c.bucket = 'committed' AND c.cost_type = bl.cost_type AND c.cost_code_id IS NOT DISTINCT FROM bl.cost_code_id), 0)
  WHERE bl.project_id = _project_id AND bl.budget_id IN (SELECT id FROM commercial_project_budgets WHERE project_id = _project_id AND status = 'active');
  UPDATE commercial_buyout_packages p SET committed_cost = coalesce((SELECT sum(amount) FROM commercial_commitments c WHERE c.buyout_package_id = p.id AND c.bucket = 'committed'), 0)
    WHERE p.project_id = _project_id;
  UPDATE commercial_buyout_packages SET status = 'committed'
    WHERE project_id = _project_id AND committed_cost > 0 AND status IN ('not_started','pricing','rfq_sent','quotes_received','under_review','approved');
END $$;
REVOKE ALL ON FUNCTION public.commercial_recompute_commitments(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commercial_commitment_line_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text; pid uuid; rec jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  IF TG_TABLE_NAME = 'commercial_purchase_order_lines' THEN SELECT status, project_id INTO st, pid FROM commercial_purchase_orders WHERE id = (rec->>'po_id')::uuid;
  ELSE SELECT status, project_id INTO st, pid FROM commercial_subcontracts WHERE id = (rec->>'subcontract_id')::uuid; END IF;
  IF TG_WHEN = 'BEFORE' THEN
    IF st NOT IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Lines are locked once the commitment is approved — use a change order'; END IF;
    RETURN NEW;
  END IF;
  PERFORM commercial_recompute_commitments(pid);
  RETURN NULL;
END $$;
CREATE TRIGGER line_lock BEFORE INSERT OR UPDATE ON public.commercial_purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_line_trigger();
CREATE TRIGGER line_lock BEFORE INSERT OR UPDATE ON public.commercial_subcontract_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_line_trigger();
CREATE TRIGGER line_rollup AFTER INSERT OR UPDATE ON public.commercial_purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_line_trigger();
CREATE TRIGGER line_rollup AFTER INSERT OR UPDATE ON public.commercial_subcontract_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_line_trigger();

CREATE OR REPLACE FUNCTION public.commercial_commitment_header_rollup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN PERFORM commercial_recompute_commitments(NEW.project_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER header_rollup AFTER UPDATE ON public.commercial_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_header_rollup();
CREATE TRIGGER header_rollup AFTER UPDATE ON public.commercial_subcontracts FOR EACH ROW EXECUTE FUNCTION public.commercial_commitment_header_rollup();

-- Create a draft PO or subcontract from a buyout package's carried quote (never auto-approved)
CREATE OR REPLACE FUNCTION public.commercial_create_commitment_from_buyout(_buyout_package_id uuid, _kind text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; q record; hid uuid;
BEGIN
  IF _kind NOT IN ('po','subcontract') THEN RAISE EXCEPTION 'Invalid type'; END IF;
  SELECT * INTO p FROM commercial_buyout_packages WHERE id = _buyout_package_id;
  IF p IS NULL OR p.tenant_id IS DISTINCT FROM public.get_user_tenant_id() OR public.is_login_blocked() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT bq.* INTO q FROM commercial_bid_packages bp JOIN commercial_bid_quotes bq ON bq.id = bp.carried_quote_id WHERE bp.id = p.bid_package_id;
  IF q IS NULL THEN RAISE EXCEPTION 'Pick the carried quote on the Bids tab first'; END IF;
  IF _kind = 'po' THEN
    INSERT INTO commercial_purchase_orders(tenant_id, project_id, vendor_id, contact_id, vendor_name, buyout_package_id, bid_quote_id)
    VALUES (p.tenant_id, p.project_id, q.vendor_id, q.contact_id, q.bidder_name, p.id, q.id) RETURNING id INTO hid;
    INSERT INTO commercial_purchase_order_lines(tenant_id, po_id, cost_code_id, cost_type, description, quantity, uom, unit_cost, buyout_package_id)
    VALUES (p.tenant_id, hid, p.cost_code_id, p.cost_type, p.name, 1, 'LS', q.adjusted_total, p.id);
  ELSE
    INSERT INTO commercial_subcontracts(tenant_id, project_id, vendor_id, contact_id, vendor_name, scope, buyout_package_id, bid_quote_id)
    VALUES (p.tenant_id, p.project_id, q.vendor_id, q.contact_id, q.bidder_name, p.name, p.id, q.id) RETURNING id INTO hid;
    INSERT INTO commercial_subcontract_lines(tenant_id, subcontract_id, cost_code_id, cost_type, description, quantity, uom, unit_cost, buyout_package_id)
    VALUES (p.tenant_id, hid, p.cost_code_id, p.cost_type, p.name, 1, 'LS', q.adjusted_total, p.id);
  END IF;
  RETURN hid;
END $$;
REVOKE ALL ON FUNCTION public.commercial_create_commitment_from_buyout(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_create_commitment_from_buyout(uuid,text) TO authenticated;

-- Audit
CREATE OR REPLACE FUNCTION public.commercial_audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; rec jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  IF rec ? 'project_id' THEN pid := (rec->>'project_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_awards' THEN pid := (rec->>'commercial_project_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_estimate_lines' THEN SELECT project_id INTO pid FROM commercial_estimates WHERE id = (rec->>'estimate_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('commercial_rfq_vendors','commercial_rfq_documents') THEN SELECT project_id INTO pid FROM commercial_rfqs WHERE id = (rec->>'rfq_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_bid_quotes' THEN SELECT project_id INTO pid FROM commercial_bid_packages WHERE id = (rec->>'package_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('commercial_purchase_order_lines','commercial_po_releases') THEN SELECT project_id INTO pid FROM commercial_purchase_orders WHERE id = (rec->>'po_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_subcontract_lines' THEN SELECT project_id INTO pid FROM commercial_subcontracts WHERE id = (rec->>'subcontract_id')::uuid;
  END IF;
  INSERT INTO public.commercial_audit_log(tenant_id, project_id, record_type, record_id, action, old_value, new_value, reason)
  VALUES ((rec->>'tenant_id')::uuid, pid, TG_TABLE_NAME, (rec->>'id')::uuid, TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    CASE WHEN TG_TABLE_NAME = 'commercial_takeoff_quantities' AND TG_OP <> 'DELETE' THEN NEW.override_reason END);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.commercial_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.commercial_purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.commercial_po_releases FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.commercial_subcontracts FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.commercial_subcontract_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.commercial_procurement_items FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();