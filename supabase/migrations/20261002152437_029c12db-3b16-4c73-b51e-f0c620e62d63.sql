CREATE TABLE public.commercial_buyout_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  budget_line_id uuid REFERENCES public.commercial_budget_lines(id) ON DELETE RESTRICT,
  cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  cost_type text NOT NULL DEFAULT 'material',
  name text NOT NULL,
  estimated_cost numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','pricing','rfq_sent','quotes_received','under_review','approved','committed','complete','void')),
  required_by_date date, assigned_to uuid, notes text,
  bid_package_id uuid UNIQUE REFERENCES public.commercial_bid_packages(id) ON DELETE RESTRICT,
  committed_cost numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX commercial_buyout_one_per_budget_line ON public.commercial_buyout_packages(budget_line_id) WHERE budget_line_id IS NOT NULL AND status <> 'void';
CREATE INDEX ON public.commercial_buyout_packages(project_id);

CREATE TABLE public.commercial_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  buyout_package_id uuid REFERENCES public.commercial_buyout_packages(id) ON DELETE RESTRICT,
  title text NOT NULL, scope text, quantities jsonb NOT NULL DEFAULT '[]', specifications text, details text,
  due_date date, delivery_requirement text, schedule_notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','closed','cancelled')),
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.commercial_rfqs(project_id);

CREATE TABLE public.commercial_rfq_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  rfq_id uuid NOT NULL REFERENCES public.commercial_rfqs(id) ON DELETE RESTRICT,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  vendor_name text NOT NULL, vendor_email text,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','sent','viewed','responded','declined')),
  invited_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, viewed_at timestamptz, responded_at timestamptz, declined_at timestamptz,
  decline_reason text, quote_amount numeric(14,2), quote_document_id uuid,
  bid_quote_id uuid REFERENCES public.commercial_bid_quotes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vendor_id IS NOT NULL OR contact_id IS NOT NULL));
CREATE UNIQUE INDEX commercial_rfq_vendor_unique ON public.commercial_rfq_vendors(rfq_id, COALESCE(vendor_id, contact_id));

CREATE TABLE public.commercial_rfq_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  rfq_id uuid NOT NULL REFERENCES public.commercial_rfqs(id) ON DELETE RESTRICT,
  document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  file_name text NOT NULL, file_path text, category text DEFAULT 'drawing',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (rfq_id, document_id));

ALTER TABLE public.commercial_bid_quotes
  ADD COLUMN freight numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN alternates_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN alternates_notes text,
  ADD COLUMN lead_time_days int,
  ADD COLUMN vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
  ADD COLUMN rfq_vendor_id uuid REFERENCES public.commercial_rfq_vendors(id) ON DELETE RESTRICT,
  ADD COLUMN adjusted_total numeric(14,2) GENERATED ALWAYS AS (round(amount,2) + freight + tax + alternates_amount) STORED;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_buyout_packages','commercial_rfqs','commercial_rfq_vendors','commercial_rfq_documents'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant access" ON public.%I FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY block_deactivated_company ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_login_blocked())) WITH CHECK (NOT (SELECT public.is_login_blocked()))', t);
    EXECUTE format('CREATE POLICY "no deletes" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
    EXECUTE format('CREATE INDEX ON public.%I (tenant_id)', t);
    IF t <> 'commercial_rfq_documents' THEN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
    END IF;
  END LOOP;
END $$;
-- committed_cost is owned by the commitment engine (Phase 2C); users can't type it
REVOKE UPDATE ON public.commercial_buyout_packages FROM authenticated;
GRANT UPDATE (name, status, required_by_date, assigned_to, notes, cost_code_id, cost_type, estimated_cost, bid_package_id) ON public.commercial_buyout_packages TO authenticated;

-- Audit (project id resolution for new tables)
CREATE OR REPLACE FUNCTION public.commercial_audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; rec jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  IF TG_TABLE_NAME IN ('commercial_takeoff_quantities','commercial_estimates','commercial_budget_lines','commercial_project_budgets','commercial_buyout_packages','commercial_rfqs','commercial_bid_packages') THEN
    pid := (rec->>'project_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_awards' THEN pid := (rec->>'commercial_project_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_estimate_lines' THEN
    SELECT project_id INTO pid FROM commercial_estimates WHERE id = (rec->>'estimate_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('commercial_rfq_vendors','commercial_rfq_documents') THEN
    SELECT project_id INTO pid FROM commercial_rfqs WHERE id = (rec->>'rfq_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_bid_quotes' THEN
    SELECT project_id INTO pid FROM commercial_bid_packages WHERE id = (rec->>'package_id')::uuid;
  END IF;
  INSERT INTO public.commercial_audit_log(tenant_id, project_id, record_type, record_id, action, old_value, new_value, reason)
  VALUES ((rec->>'tenant_id')::uuid, pid, TG_TABLE_NAME, (rec->>'id')::uuid, TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    CASE WHEN TG_TABLE_NAME = 'commercial_takeoff_quantities' AND TG_OP <> 'DELETE' THEN NEW.override_reason END);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER audit_cbo AFTER INSERT OR UPDATE ON public.commercial_buyout_packages FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_crfq AFTER INSERT OR UPDATE ON public.commercial_rfqs FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_crv AFTER INSERT OR UPDATE ON public.commercial_rfq_vendors FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_crd AFTER INSERT ON public.commercial_rfq_documents FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_cbp AFTER INSERT OR UPDATE OR DELETE ON public.commercial_bid_packages FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_cbq AFTER INSERT OR UPDATE OR DELETE ON public.commercial_bid_quotes FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();

-- Suggest buyout packages from the awarded budget (idempotent; never purchases)
CREATE OR REPLACE FUNCTION public.commercial_suggest_buyout_packages(_project_id uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid := public.get_user_tenant_id(); r record; bp uuid; n int := 0; nm text;
BEGIN
  IF public.is_login_blocked() OR NOT EXISTS (SELECT 1 FROM commercial_projects WHERE id = _project_id AND tenant_id = tid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM commercial_project_budgets WHERE project_id = _project_id AND status = 'active') THEN RAISE EXCEPTION 'Award the project first so there is a budget to buy out'; END IF;
  FOR r IN
    SELECT bl.*, cc.code, cc.name AS cc_name FROM commercial_budget_lines bl
    JOIN commercial_project_budgets b ON b.id = bl.budget_id AND b.status = 'active'
    LEFT JOIN commercial_cost_codes cc ON cc.id = bl.cost_code_id
    WHERE bl.project_id = _project_id AND bl.cost_type IN ('material','subcontract','equipment','labor') AND bl.original_budget > 0
      AND NOT EXISTS (SELECT 1 FROM commercial_buyout_packages p WHERE p.budget_line_id = bl.id AND p.status <> 'void')
    ORDER BY cc.code NULLS LAST, bl.cost_type
  LOOP
    nm := concat_ws(' — ', coalesce(r.code || ' ' || r.cc_name, 'Unassigned'), initcap(r.cost_type));
    INSERT INTO commercial_bid_packages(tenant_id, project_id, name, scope) VALUES (tid, _project_id, nm, 'Buyout package') RETURNING id INTO bp;
    INSERT INTO commercial_buyout_packages(tenant_id, project_id, budget_line_id, cost_code_id, cost_type, name, estimated_cost, bid_package_id)
    VALUES (tid, _project_id, r.id, r.cost_code_id, r.cost_type, nm, r.revised_budget, bp);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.commercial_suggest_buyout_packages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_suggest_buyout_packages(uuid) TO authenticated;

-- Record a vendor's RFQ quote: creates the levelable bid quote and advances statuses
CREATE OR REPLACE FUNCTION public.commercial_record_rfq_quote(_rfq_vendor_id uuid, _amount numeric, _freight numeric DEFAULT 0, _tax numeric DEFAULT 0, _lead_time_days int DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rv record; rf record; bo record; bp uuid; q uuid;
BEGIN
  SELECT * INTO rv FROM commercial_rfq_vendors WHERE id = _rfq_vendor_id;
  IF rv IS NULL OR rv.tenant_id IS DISTINCT FROM public.get_user_tenant_id() OR public.is_login_blocked() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'Quote amount must be zero or more'; END IF;
  SELECT * INTO rf FROM commercial_rfqs WHERE id = rv.rfq_id;
  SELECT * INTO bo FROM commercial_buyout_packages WHERE id = rf.buyout_package_id;
  bp := bo.bid_package_id;
  IF bp IS NULL THEN
    INSERT INTO commercial_bid_packages(tenant_id, project_id, name, scope) VALUES (rv.tenant_id, rf.project_id, coalesce(bo.name, rf.title), rf.scope) RETURNING id INTO bp;
    IF bo.id IS NOT NULL THEN UPDATE commercial_buyout_packages SET bid_package_id = bp WHERE id = bo.id; END IF;
  END IF;
  IF rv.bid_quote_id IS NOT NULL THEN
    UPDATE commercial_bid_quotes SET amount = round(_amount,2), freight = round(coalesce(_freight,0),2), tax = round(coalesce(_tax,0),2), lead_time_days = _lead_time_days WHERE id = rv.bid_quote_id;
    q := rv.bid_quote_id;
  ELSE
    INSERT INTO commercial_bid_quotes(tenant_id, package_id, bidder_name, amount, freight, tax, lead_time_days, vendor_id, contact_id, rfq_vendor_id)
    VALUES (rv.tenant_id, bp, rv.vendor_name, round(_amount,2), round(coalesce(_freight,0),2), round(coalesce(_tax,0),2), _lead_time_days, rv.vendor_id, rv.contact_id, rv.id)
    RETURNING id INTO q;
  END IF;
  UPDATE commercial_rfq_vendors SET status = 'responded', responded_at = coalesce(responded_at, now()), quote_amount = round(_amount,2), bid_quote_id = q WHERE id = rv.id;
  IF bo.id IS NOT NULL AND bo.status IN ('not_started','pricing','rfq_sent') THEN UPDATE commercial_buyout_packages SET status = 'quotes_received' WHERE id = bo.id; END IF;
  RETURN q;
END $$;
REVOKE ALL ON FUNCTION public.commercial_record_rfq_quote(uuid,numeric,numeric,numeric,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_record_rfq_quote(uuid,numeric,numeric,numeric,int) TO authenticated;