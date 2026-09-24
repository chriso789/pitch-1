CREATE TABLE public.commercial_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  name text NOT NULL, project_number text, client_name text, owner_name text, gc_name text,
  architect_name text, engineer_name text, estimator_id uuid, address text,
  bid_due_date date, status text NOT NULL DEFAULT 'bidding', roof_area_sf numeric,
  pipeline_entry_id uuid, contact_id uuid, notes text, metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_assemblies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  name text NOT NULL, system_type text, description text, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_assembly_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  assembly_id uuid NOT NULL REFERENCES public.commercial_assemblies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'material', name text NOT NULL, driver text NOT NULL DEFAULT 'roof_area',
  qty_per_driver numeric NOT NULL DEFAULT 1, uom text NOT NULL DEFAULT 'SF', unit_cost numeric NOT NULL DEFAULT 0,
  waste_pct numeric NOT NULL DEFAULT 0, crew_rate_per_day numeric, crew_day_cost numeric, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_takeoff_quantities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE CASCADE,
  driver text NOT NULL, label text NOT NULL, roof_section text, value numeric NOT NULL DEFAULT 0, uom text NOT NULL DEFAULT 'SF',
  source_sheet text, source text NOT NULL DEFAULT 'manual', confidence numeric,
  scale_status text NOT NULL DEFAULT 'unverified', review_status text NOT NULL DEFAULT 'review_required',
  overridden_from numeric, override_reason text, verified_by uuid, verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Base Bid', assembly_id uuid REFERENCES public.commercial_assemblies(id),
  general_conditions numeric NOT NULL DEFAULT 0, overhead_pct numeric NOT NULL DEFAULT 10, profit_pct numeric NOT NULL DEFAULT 10,
  bond_pct numeric NOT NULL DEFAULT 0, tax_pct numeric NOT NULL DEFAULT 0,
  material_total numeric NOT NULL DEFAULT 0, labor_total numeric NOT NULL DEFAULT 0, sub_total numeric NOT NULL DEFAULT 0,
  bid_total numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', exclusions text, alternates jsonb NOT NULL DEFAULT '[]',
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  estimate_id uuid NOT NULL REFERENCES public.commercial_estimates(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'material', description text NOT NULL, quantity numeric NOT NULL DEFAULT 0, uom text,
  unit_cost numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, takeoff_quantity_id uuid REFERENCES public.commercial_takeoff_quantities(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_estimate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  estimate_id uuid NOT NULL REFERENCES public.commercial_estimates(id) ON DELETE CASCADE,
  version_number int NOT NULL, status text NOT NULL DEFAULT 'submitted', snapshot jsonb NOT NULL, bid_total numeric NOT NULL DEFAULT 0,
  submitted_by uuid DEFAULT auth.uid(), approved_by uuid, approved_at timestamptz, comments text,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_bid_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  project_id uuid NOT NULL REFERENCES public.commercial_projects(id) ON DELETE CASCADE,
  name text NOT NULL, scope text, carried_quote_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_bid_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  package_id uuid NOT NULL REFERENCES public.commercial_bid_packages(id) ON DELETE CASCADE,
  bidder_name text NOT NULL, amount numeric NOT NULL DEFAULT 0, includes text, excludes text, scope_gaps text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  source text NOT NULL, file_name text, status text NOT NULL DEFAULT 'pending', rows_imported int NOT NULL DEFAULT 0,
  error text, result jsonb NOT NULL DEFAULT '{}', created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.commercial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid, record_type text NOT NULL, record_id uuid, action text NOT NULL,
  old_value jsonb, new_value jsonb, reason text, source text DEFAULT 'app', user_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_projects','commercial_assemblies','commercial_assembly_components','commercial_takeoff_quantities','commercial_estimates','commercial_estimate_lines','commercial_estimate_versions','commercial_bid_packages','commercial_bid_quotes','commercial_import_jobs'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant access" ON public.%I FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('CREATE INDEX ON public.%I (tenant_id)', t);
    IF t <> 'commercial_estimate_versions' THEN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT ON public.commercial_audit_log TO authenticated;
GRANT ALL ON public.commercial_audit_log TO service_role;
ALTER TABLE public.commercial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read" ON public.commercial_audit_log FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert" ON public.commercial_audit_log FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Versions immutable
CREATE POLICY "no version edits" ON public.commercial_estimate_versions AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY "no version deletes" ON public.commercial_estimate_versions AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- Audit trigger for takeoff quantities and estimates
CREATE OR REPLACE FUNCTION public.commercial_audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'commercial_takeoff_quantities' THEN pid := COALESCE(NEW.project_id, OLD.project_id);
  ELSIF TG_TABLE_NAME = 'commercial_estimates' THEN pid := COALESCE(NEW.project_id, OLD.project_id);
  END IF;
  INSERT INTO public.commercial_audit_log(tenant_id, project_id, record_type, record_id, action, old_value, new_value, reason)
  VALUES (COALESCE(NEW.tenant_id, OLD.tenant_id), pid, TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    CASE WHEN TG_TABLE_NAME = 'commercial_takeoff_quantities' AND TG_OP <> 'DELETE' THEN NEW.override_reason END);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER audit_ctq AFTER INSERT OR UPDATE OR DELETE ON public.commercial_takeoff_quantities FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();
CREATE TRIGGER audit_ce AFTER INSERT OR UPDATE OR DELETE ON public.commercial_estimates FOR EACH ROW EXECUTE FUNCTION public.commercial_audit_trigger();

-- Review gate
CREATE OR REPLACE FUNCTION public.commercial_version_review_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.commercial_takeoff_quantities q
   JOIN public.commercial_estimates e ON e.project_id = q.project_id
   WHERE e.id = NEW.estimate_id AND q.review_status NOT IN ('verified','manually_overridden','rejected');
  IF bad > 0 THEN RAISE EXCEPTION '% takeoff quantities still need review before this estimate can be submitted', bad; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_gate BEFORE INSERT ON public.commercial_estimate_versions FOR EACH ROW EXECUTE FUNCTION public.commercial_version_review_gate();