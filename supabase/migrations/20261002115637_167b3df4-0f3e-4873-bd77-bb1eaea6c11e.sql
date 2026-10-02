CREATE TABLE public.commercial_cost_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  code text NOT NULL, name text NOT NULL, division text,
  parent_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code));

ALTER TABLE public.commercial_estimate_lines
  ADD COLUMN cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  ADD COLUMN cost_type text CHECK (cost_type IN ('material','labor','equipment','subcontract','other','general_conditions')),
  ADD COLUMN assembly_id uuid REFERENCES public.commercial_assemblies(id) ON DELETE SET NULL,
  ADD COLUMN blueprint_measurement_id uuid,
  ADD COLUMN blueprint_trade_takeoff_id uuid,
  ADD COLUMN source_provenance jsonb NOT NULL DEFAULT '{}';

CREATE TABLE public.commercial_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  commercial_project_id uuid NOT NULL UNIQUE REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  commercial_estimate_id uuid NOT NULL REFERENCES public.commercial_estimates(id) ON DELETE RESTRICT,
  commercial_estimate_version_id uuid NOT NULL REFERENCES public.commercial_estimate_versions(id) ON DELETE RESTRICT,
  awarded_contract_value numeric(14,2) NOT NULL, award_date date NOT NULL DEFAULT current_date,
  awarded_by uuid DEFAULT auth.uid(), award_notes text,
  original_cost numeric(14,2) NOT NULL, original_gross_profit numeric(14,2) NOT NULL, original_gross_margin numeric(7,4),
  snapshot_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_project_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  award_id uuid NOT NULL REFERENCES public.commercial_awards(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX commercial_one_active_budget ON public.commercial_project_budgets(project_id) WHERE status = 'active';

CREATE TABLE public.commercial_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE RESTRICT,
  budget_id uuid NOT NULL REFERENCES public.commercial_project_budgets(id) ON DELETE RESTRICT,
  cost_code_id uuid REFERENCES public.commercial_cost_codes(id) ON DELETE RESTRICT,
  cost_type text NOT NULL, description text,
  original_budget numeric(14,2) NOT NULL DEFAULT 0,
  approved_budget_changes numeric(14,2) NOT NULL DEFAULT 0,
  revised_budget numeric(14,2) GENERATED ALWAYS AS (original_budget + approved_budget_changes) STORED,
  pending_commitments numeric(14,2) NOT NULL DEFAULT 0,
  committed_cost numeric(14,2) NOT NULL DEFAULT 0,
  actual_cost numeric(14,2) NOT NULL DEFAULT 0,
  forecast_cost numeric(14,2),
  projected_final_cost numeric(14,2) GENERATED ALWAYS AS (COALESCE(forecast_cost, original_budget + approved_budget_changes)) STORED,
  cost_to_complete numeric(14,2) GENERATED ALWAYS AS (COALESCE(forecast_cost, original_budget + approved_budget_changes) - actual_cost) STORED,
  variance numeric(14,2) GENERATED ALWAYS AS ((original_budget + approved_budget_changes) - COALESCE(forecast_cost, original_budget + approved_budget_changes)) STORED,
  original_revenue numeric(14,2) NOT NULL DEFAULT 0,
  approved_revenue_changes numeric(14,2) NOT NULL DEFAULT 0,
  revised_revenue numeric(14,2) GENERATED ALWAYS AS (original_revenue + approved_revenue_changes) STORED,
  projected_revenue numeric(14,2) GENERATED ALWAYS AS (original_revenue + approved_revenue_changes) STORED,
  projected_gross_profit numeric(14,2) GENERATED ALWAYS AS ((original_revenue + approved_revenue_changes) - COALESCE(forecast_cost, original_budget + approved_budget_changes)) STORED,
  source_estimate_line_ids uuid[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.commercial_budget_lines(budget_id);
CREATE INDEX ON public.commercial_budget_lines(project_id, cost_code_id);

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.commercial_cost_codes TO authenticated;
GRANT SELECT ON public.commercial_awards TO authenticated;
GRANT SELECT ON public.commercial_project_budgets TO authenticated;
GRANT SELECT ON public.commercial_budget_lines TO authenticated;
GRANT UPDATE (forecast_cost, metadata) ON public.commercial_budget_lines TO authenticated;
GRANT ALL ON public.commercial_cost_codes, public.commercial_awards, public.commercial_project_budgets, public.commercial_budget_lines TO service_role;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_cost_codes','commercial_awards','commercial_project_budgets','commercial_budget_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant access" ON public.%I FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE POLICY block_deactivated_company ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_login_blocked())) WITH CHECK (NOT (SELECT public.is_login_blocked()))', t);
    EXECUTE format('CREATE POLICY "no deletes" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
    EXECUTE format('CREATE INDEX ON public.%I (tenant_id)', t);
  END LOOP;
END $$;
CREATE POLICY "awards immutable" ON public.commercial_awards AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.commercial_cost_codes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.commercial_project_budgets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.commercial_budget_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Originals locked on budget lines
CREATE OR REPLACE FUNCTION public.commercial_budget_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.original_budget IS DISTINCT FROM OLD.original_budget OR NEW.original_revenue IS DISTINCT FROM OLD.original_revenue
     OR NEW.source_estimate_line_ids IS DISTINCT FROM OLD.source_estimate_line_ids OR NEW.budget_id IS DISTINCT FROM OLD.budget_id
     OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id OR NEW.cost_type IS DISTINCT FROM OLD.cost_type THEN
    RAISE EXCEPTION 'Original budget values are locked. Use a budget change instead.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budget_line_guard BEFORE UPDATE ON public.commercial_budget_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_budget_line_guard();

-- Extended audit trigger
CREATE OR REPLACE FUNCTION public.commercial_audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; rec jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  IF TG_TABLE_NAME IN ('commercial_takeoff_quantities','commercial_estimates','commercial_budget_lines','commercial_project_budgets') THEN
    pid := (rec->>'project_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_awards' THEN pid := (rec->>'commercial_project_id')::uuid;
  ELSIF TG_TABLE_NAME = 'commercial_estimate_lines' THEN
    SELECT project_id INTO pid FROM commercial_estimates WHERE id = (rec->>'estimate_id')::uuid;
  END IF;
  INSERT INTO public.commercial_audit_log(tenant_id, project_id, record_type, record_id, action, old_value, new_value, reason)
  VALUES ((rec->>'tenant_id')::uuid, pid, TG_TABLE_NAME, (rec->>'id')::uuid, TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    CASE WHEN TG_TABLE_NAME = 'commercial_takeoff_quantities' AND TG_OP <> 'DELETE' THEN NEW.override_reason END);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER audit_ccc AFTER INSERT OR UPDATE OR DELETE ON public.commercial_cost_codes FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_cel AFTER INSERT OR UPDATE OR DELETE ON public.commercial_estimate_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_caw AFTER INSERT ON public.commercial_awards FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_cpb AFTER INSERT OR UPDATE ON public.commercial_project_budgets FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_cbl AFTER INSERT OR UPDATE ON public.commercial_budget_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();

-- Seed starter CSI roofing cost codes for the caller's company (idempotent)
CREATE OR REPLACE FUNCTION public.commercial_seed_cost_codes() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid := public.get_user_tenant_id(); n int; div_id uuid;
BEGIN
  IF tid IS NULL OR public.is_login_blocked() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO commercial_cost_codes(tenant_id, code, name, division, sort_order) VALUES
    (tid,'01','General Requirements','01',10),(tid,'07','Thermal & Moisture Protection','07',70)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO div_id FROM commercial_cost_codes WHERE tenant_id = tid AND code = '01';
  INSERT INTO commercial_cost_codes(tenant_id, code, name, division, parent_id, sort_order) VALUES
    (tid,'01 50 00','Temporary Facilities & Controls','01',div_id,11),(tid,'01 54 00','Construction Aids / Equipment','01',div_id,12)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT id INTO div_id FROM commercial_cost_codes WHERE tenant_id = tid AND code = '07';
  INSERT INTO commercial_cost_codes(tenant_id, code, name, division, parent_id, sort_order) VALUES
    (tid,'07 22 00','Roof & Deck Insulation','07',div_id,71),(tid,'07 31 13','Asphalt Shingles','07',div_id,72),
    (tid,'07 41 13','Metal Roof Panels','07',div_id,73),(tid,'07 52 00','Modified Bituminous Roofing','07',div_id,74),
    (tid,'07 53 23','EPDM Roofing','07',div_id,75),(tid,'07 54 23','TPO Roofing','07',div_id,76),
    (tid,'07 62 00','Sheet Metal Flashing & Trim','07',div_id,77),(tid,'07 71 00','Roof Specialties','07',div_id,78),
    (tid,'07 72 00','Roof Accessories','07',div_id,79),(tid,'07 92 00','Joint Sealants','07',div_id,80)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  SELECT count(*) INTO n FROM commercial_cost_codes WHERE tenant_id = tid;
  RETURN n;
END $$;

-- Award: approved version -> immutable snapshot -> budget (deterministic)
CREATE OR REPLACE FUNCTION public.commercial_award_version(_version_id uuid, _notes text DEFAULT NULL, _award_date date DEFAULT current_date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; e record; aw_id uuid; b_id uuid; contract numeric; cost numeric := 0; gc numeric; tax numeric;
  rec record; alloc numeric := 0; n int := 0; cnt int; big_id uuid;
BEGIN
  SELECT * INTO v FROM commercial_estimate_versions WHERE id = _version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v.tenant_id IS DISTINCT FROM public.get_user_tenant_id() OR public.is_login_blocked() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF v.status <> 'approved' THEN RAISE EXCEPTION 'Only a fully approved version can be awarded'; END IF;
  SELECT * INTO e FROM commercial_estimates WHERE id = v.estimate_id;
  IF EXISTS (SELECT 1 FROM commercial_awards WHERE commercial_project_id = e.project_id) THEN RAISE EXCEPTION 'This project is already awarded'; END IF;
  contract := round(coalesce(v.bid_total,0), 2);
  gc := round(coalesce((v.snapshot->'estimate'->>'general_conditions')::numeric, 0), 2);
  tax := round(coalesce((v.snapshot->'totals'->>'tax')::numeric, 0), 2);

  CREATE TEMP TABLE _bl ON COMMIT DROP AS
  SELECT ccid AS cost_code_id, ctype AS cost_type, round(sum(tot),2) AS amt, array_agg(lid) AS ids
  FROM (
    SELECT (l->>'id')::uuid AS lid,
      COALESCE(NULLIF(l->>'cost_code_id','')::uuid, cl.cost_code_id) AS ccid,
      COALESCE(l->>'cost_type', cl.cost_type, CASE l->>'kind' WHEN 'labor' THEN 'labor' WHEN 'equipment' THEN 'equipment' WHEN 'subcontract' THEN 'subcontract' WHEN 'material' THEN 'material' ELSE 'other' END) AS ctype,
      coalesce((l->>'total')::numeric, 0) AS tot
    FROM jsonb_array_elements(coalesce(v.snapshot->'lines','[]'::jsonb)) l
    LEFT JOIN commercial_estimate_lines cl ON cl.id = (l->>'id')::uuid
  ) s GROUP BY ccid, ctype;
  IF gc <> 0 THEN INSERT INTO _bl VALUES (NULL, 'general_conditions', gc, '{}'); END IF;
  IF tax <> 0 THEN INSERT INTO _bl VALUES (NULL, 'other', tax, '{}'); END IF;
  SELECT coalesce(sum(amt),0), count(*) INTO cost, cnt FROM _bl;
  IF cnt = 0 THEN RAISE EXCEPTION 'The awarded version has no cost lines'; END IF;

  INSERT INTO commercial_awards(tenant_id, commercial_project_id, commercial_estimate_id, commercial_estimate_version_id,
    awarded_contract_value, award_date, award_notes, original_cost, original_gross_profit, original_gross_margin, snapshot_json)
  VALUES (v.tenant_id, e.project_id, e.id, v.id, contract, coalesce(_award_date, current_date), _notes, cost, contract - cost,
    CASE WHEN contract <> 0 THEN round((contract - cost) / contract, 4) END, v.snapshot)
  RETURNING id INTO aw_id;

  INSERT INTO commercial_project_budgets(tenant_id, project_id, award_id) VALUES (v.tenant_id, e.project_id, aw_id) RETURNING id INTO b_id;

  FOR rec IN SELECT * FROM _bl ORDER BY amt DESC LOOP
    n := n + 1;
    INSERT INTO commercial_budget_lines(tenant_id, project_id, budget_id, cost_code_id, cost_type, description, original_budget, original_revenue, source_estimate_line_ids, metadata)
    VALUES (v.tenant_id, e.project_id, b_id, rec.cost_code_id, rec.cost_type,
      CASE WHEN rec.cost_type = 'general_conditions' THEN 'General conditions' WHEN rec.cost_code_id IS NULL AND rec.cost_type = 'other' AND rec.ids = '{}' THEN 'Sales tax' END,
      rec.amt, CASE WHEN cost <> 0 THEN round(contract * rec.amt / cost, 2) ELSE 0 END, rec.ids,
      jsonb_build_object('award_id', aw_id, 'estimate_version_id', v.id))
    RETURNING id INTO big_id;
    IF n = 1 THEN alloc := 0; END IF;
  END LOOP;
  -- Reconcile rounding so revenue totals exactly equal the contract (adjust the largest line)
  SELECT contract - coalesce(sum(original_revenue),0) INTO alloc FROM commercial_budget_lines WHERE budget_id = b_id;
  IF alloc <> 0 THEN
    ALTER TABLE commercial_budget_lines DISABLE TRIGGER budget_line_guard;
    UPDATE commercial_budget_lines SET original_revenue = original_revenue + alloc
      WHERE id = (SELECT id FROM commercial_budget_lines WHERE budget_id = b_id ORDER BY original_budget DESC, id LIMIT 1);
    ALTER TABLE commercial_budget_lines ENABLE TRIGGER budget_line_guard;
  END IF;

  UPDATE commercial_projects SET status = 'won' WHERE id = e.project_id;
  RETURN aw_id;
END $$;
REVOKE ALL ON FUNCTION public.commercial_award_version(uuid,text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commercial_seed_cost_codes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_award_version(uuid,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_seed_cost_codes() TO authenticated;