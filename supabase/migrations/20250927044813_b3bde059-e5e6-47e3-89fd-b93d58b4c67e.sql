-- =========================
-- Extensions & prerequisites
-- =========================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================
-- Core tables
-- =========================

-- Manager-maintained templates
CREATE TABLE IF NOT EXISTS public.templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL,
  labor       jsonb NOT NULL DEFAULT '{}',
  overhead    jsonb NOT NULL DEFAULT '{}',
  currency    char(3) NOT NULL DEFAULT 'USD',
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON public.templates (tenant_id);

-- Items with formula-driven quantity
CREATE TABLE IF NOT EXISTS public.template_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  item_name     text NOT NULL,
  unit          text NOT NULL,
  waste_pct     numeric(5,4) NOT NULL DEFAULT 0,
  unit_cost     numeric(12,2) NOT NULL DEFAULT 0,
  qty_formula   text NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Measurements stored as JSONB per estimate
CREATE TABLE IF NOT EXISTS public.estimate_measurements (
  estimate_id uuid PRIMARY KEY REFERENCES public.estimates(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  payload     jsonb NOT NULL,
  squares     numeric(14,4) GENERATED ALWAYS AS (
    COALESCE( (NULLIF(payload->>'roof_area_sqft','')::numeric), 0 ) / 100.0
  ) STORED,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimate_measurements_tenant ON public.estimate_measurements (tenant_id);

-- Binding template -> estimate
CREATE TABLE IF NOT EXISTS public.estimate_bindings (
  estimate_id uuid PRIMARY KEY REFERENCES public.estimates(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.templates(id) ON DELETE RESTRICT,
  bound_by    uuid,
  bound_at    timestamptz NOT NULL DEFAULT now()
);

-- Computed line items captured for audit/portal display
CREATE TABLE IF NOT EXISTS public.estimate_cost_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id       uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  template_item_id  uuid REFERENCES public.template_items(id) ON DELETE SET NULL,
  item_name         text NOT NULL,
  qty               numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  line_total        numeric(12,2) NOT NULL DEFAULT 0,
  computed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_items_est ON public.estimate_cost_items (estimate_id);

-- Computed totals (Materials, Labor, Overhead, Profit, etc.)
CREATE TABLE IF NOT EXISTS public.estimate_costs (
  estimate_id     uuid PRIMARY KEY REFERENCES public.estimates(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'USD',
  materials       numeric(12,2) NOT NULL DEFAULT 0,
  labor           numeric(12,2) NOT NULL DEFAULT 0,
  overhead        numeric(12,2) NOT NULL DEFAULT 0,
  cost_pre_profit numeric(12,2) NOT NULL DEFAULT 0,
  mode            text NOT NULL DEFAULT 'margin',
  margin_pct      numeric(5,4),
  markup_pct      numeric(5,4),
  sale_price      numeric(12,2) NOT NULL DEFAULT 0,
  profit          numeric(12,2) NOT NULL DEFAULT 0,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_costs_tenant ON public.estimate_costs (tenant_id);

-- =========================
-- RLS (tenant guard)
-- =========================
ALTER TABLE public.templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_bindings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_cost_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_costs      ENABLE ROW LEVEL SECURITY;

-- READ
CREATE POLICY sel_templates_tenant ON public.templates
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY sel_template_items_tenant ON public.template_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_items.template_id
            AND t.tenant_id = get_user_tenant_id())
  );

CREATE POLICY sel_est_measurements_tenant ON public.estimate_measurements
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY sel_est_bindings_tenant ON public.estimate_bindings
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY sel_est_cost_items_tenant ON public.estimate_cost_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = estimate_cost_items.estimate_id
            AND e.tenant_id = get_user_tenant_id())
  );

CREATE POLICY sel_est_costs_tenant ON public.estimate_costs
  FOR SELECT USING (tenant_id = get_user_tenant_id());

-- WRITE
CREATE POLICY ins_templates_tenant ON public.templates
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY upd_templates_tenant ON public.templates
  FOR UPDATE USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY ins_template_items_tenant ON public.template_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_items.template_id
            AND t.tenant_id = get_user_tenant_id())
  );

CREATE POLICY upd_template_items_tenant ON public.template_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_items.template_id
            AND t.tenant_id = get_user_tenant_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_items.template_id
            AND t.tenant_id = get_user_tenant_id())
  );

CREATE POLICY ins_est_measurements_tenant ON public.estimate_measurements
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY upd_est_measurements_tenant ON public.estimate_measurements
  FOR UPDATE USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY ins_est_bindings_tenant ON public.estimate_bindings
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY ins_est_cost_items_tenant ON public.estimate_cost_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = estimate_cost_items.estimate_id
            AND e.tenant_id = get_user_tenant_id())
  );

CREATE POLICY ins_est_costs_tenant ON public.estimate_costs
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY upd_est_costs_tenant ON public.estimate_costs
  FOR UPDATE USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- =========================
-- Safe formula evaluation
-- =========================
CREATE OR REPLACE FUNCTION public.est_sanitize_formula(expr text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  ok boolean;
BEGIN
  IF expr IS NULL OR length(trim(expr))=0 THEN
    RAISE EXCEPTION 'Empty qty_formula';
  END IF;

  IF expr ~ '[^a-zA-Z0-9_+\-*/().\s]' THEN
    RAISE EXCEPTION 'Illegal characters in formula';
  END IF;

  IF expr ~* '\y[a-z]+' AND expr ~ '\(' THEN
    IF NOT (expr ~* '^(?:\s*(ceil|floor|round)\s*\(|[a-z0-9_+\-*/().\s]+)$') THEN
      PERFORM 1;
    END IF;
  END IF;

  RETURN lower(trim(expr));
END
$$;

CREATE OR REPLACE FUNCTION public.est_eval_qty(expr text, vars jsonb)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  s   text := public.est_sanitize_formula(expr);
  vname text;
  vval  text;
  sql  text;
  res  numeric;
BEGIN
  FOR vname IN SELECT key FROM jsonb_object_keys(vars) AS key LOOP
    vval := COALESCE(NULLIF(vars->>vname,''),'0');
    s := regexp_replace(s, '\m' || vname || '\M', '(' || vval || ')', 'gi');
  END LOOP;

  s := regexp_replace(s, '\m[a-z_][a-z0-9_]*\M', '0', 'gi');

  sql := 'SELECT (' || s || ')::numeric';
  EXECUTE sql INTO res;
  RETURN COALESCE(res,0);
END
$$;

-- =========================
-- Compute helpers
-- =========================
CREATE OR REPLACE FUNCTION public.est_bind_template(p_estimate_id uuid, p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.estimates WHERE id = p_estimate_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;

  INSERT INTO public.estimate_bindings(estimate_id, tenant_id, template_id, bound_by)
  VALUES (p_estimate_id, v_tenant, p_template_id, auth.uid())
  ON CONFLICT (estimate_id) DO UPDATE
    SET template_id = EXCLUDED.template_id,
        bound_by    = EXCLUDED.bound_by,
        bound_at    = now();
END
$$;

CREATE OR REPLACE FUNCTION public.est_ingest_measurements(p_estimate_id uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.estimates WHERE id = p_estimate_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Estimate not found'; END IF;

  INSERT INTO public.estimate_measurements(estimate_id, tenant_id, payload)
  VALUES (p_estimate_id, v_tenant, p_payload)
  ON CONFLICT (estimate_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        updated_at = now();
END
$$;

CREATE OR REPLACE FUNCTION public.est_compute_pricing(
  p_estimate_id uuid,
  p_mode text DEFAULT 'margin',
  p_pct  numeric DEFAULT 0.30,
  p_currency char(3) DEFAULT 'USD'
)
RETURNS TABLE(
  estimate_id uuid,
  currency char(3),
  materials numeric,
  labor numeric,
  overhead numeric,
  cost_pre_profit numeric,
  mode text,
  margin_pct numeric,
  markup_pct numeric,
  sale_price numeric,
  profit numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_template_id uuid;
  v_meas jsonb;
  v_squares numeric := 0;
  v_materials numeric := 0;
  v_labor numeric := 0;
  v_overhead numeric := 0;
  v_cost numeric := 0;
  v_sale numeric := 0;
  v_profit numeric := 0;
  v_margin numeric := NULL;
  v_markup numeric := NULL;
  v_rate  numeric := 0;
  v_complex jsonb := '{}'::jsonb;
  v_type text;
  v_pct  numeric := COALESCE(p_pct, 0.30);
BEGIN
  SELECT template_id INTO v_template_id FROM public.estimate_bindings WHERE estimate_id=p_estimate_id;
  IF v_template_id IS NULL THEN RAISE EXCEPTION 'Template not bound to estimate'; END IF;

  SELECT payload, squares INTO v_meas, v_squares
  FROM public.estimate_measurements WHERE estimate_id=p_estimate_id;
  IF v_meas IS NULL THEN RAISE EXCEPTION 'Measurements missing for estimate'; END IF;

  SELECT (labor->>'rate_per_square')::numeric, COALESCE(labor->'complexity','{}'::jsonb), (overhead->>'type'), COALESCE((overhead->>'percent')::numeric,0)
  INTO v_rate, v_complex, v_type, v_pct
  FROM public.templates WHERE id=v_template_id;

  DELETE FROM public.estimate_cost_items WHERE estimate_id=p_estimate_id;
  INSERT INTO public.estimate_cost_items(estimate_id, template_item_id, item_name, qty, unit_cost, line_total, computed_at)
  SELECT
    p_estimate_id,
    ti.id,
    ti.item_name,
    GREATEST(0, public.est_eval_qty(ti.qty_formula, v_meas) * (1 + ti.waste_pct)) AS qty,
    ti.unit_cost,
    round( (GREATEST(0, public.est_eval_qty(ti.qty_formula, v_meas) * (1 + ti.waste_pct))) * ti.unit_cost, 2 ) AS line_total,
    now()
  FROM public.template_items ti
  WHERE ti.template_id = v_template_id AND ti.active = true;

  SELECT COALESCE(sum(line_total),0) INTO v_materials
  FROM public.estimate_cost_items WHERE estimate_id=p_estimate_id;

  v_labor := round( COALESCE(v_squares,0) * COALESCE(v_rate,0)
                    * COALESCE((v_complex->>'pitch_factor')::numeric,1)
                    * COALESCE((v_complex->>'stories_factor')::numeric,1)
                    * COALESCE((v_complex->>'tear_off_factor')::numeric,1), 2);

  IF v_type = 'percent' OR v_type = 'both' THEN
    v_overhead := v_overhead + round( (v_materials + v_labor) * COALESCE((SELECT (overhead->>'percent')::numeric FROM public.templates WHERE id=v_template_id),0), 2 );
  END IF;
  IF v_type = 'fixed' OR v_type = 'both' THEN
    v_overhead := v_overhead + round( COALESCE((SELECT (overhead->>'fixed')::numeric FROM public.templates WHERE id=v_template_id),0), 2 );
  END IF;

  v_cost := round(v_materials + v_labor + v_overhead, 2);

  IF lower(p_mode) = 'margin' THEN
    v_margin := v_pct;
    v_sale   := round( CASE WHEN 1 - v_margin <= 0 THEN v_cost ELSE v_cost / (1 - v_margin) END, 2 );
    v_profit := round(v_sale - v_cost, 2);
    v_markup := CASE WHEN 1 - v_margin = 0 THEN NULL ELSE round( v_margin / (1 - v_margin), 4) END;
  ELSE
    v_markup := v_pct;
    v_sale   := round( v_cost * (1 + v_markup), 2 );
    v_profit := round( v_sale - v_cost, 2 );
    v_margin := round( v_profit / NULLIF(v_sale,0), 4 );
  END IF;

  INSERT INTO public.estimate_costs(estimate_id, tenant_id, currency, materials, labor, overhead, cost_pre_profit, mode, margin_pct, markup_pct, sale_price, profit, computed_at)
  SELECT p_estimate_id, e.tenant_id, p_currency, v_materials, v_labor, v_overhead, v_cost, lower(p_mode), v_margin, v_markup, v_sale, v_profit, now()
  FROM public.estimates e WHERE e.id=p_estimate_id
  ON CONFLICT (estimate_id) DO UPDATE
    SET currency        = EXCLUDED.currency,
        materials       = EXCLUDED.materials,
        labor           = EXCLUDED.labor,
        overhead        = EXCLUDED.overhead,
        cost_pre_profit = EXCLUDED.cost_pre_profit,
        mode            = EXCLUDED.mode,
        margin_pct      = EXCLUDED.margin_pct,
        markup_pct      = EXCLUDED.markup_pct,
        sale_price      = EXCLUDED.sale_price,
        profit          = EXCLUDED.profit,
        computed_at     = now();

  estimate_id     := p_estimate_id;
  currency        := p_currency;
  materials       := v_materials;
  labor           := v_labor;
  overhead        := v_overhead;
  cost_pre_profit := v_cost;
  mode            := lower(p_mode);
  margin_pct      := v_margin;
  markup_pct      := v_markup;
  sale_price      := v_sale;
  profit          := v_profit;
  RETURN NEXT;
END
$$;

-- =========================
-- Supabase RPCs
-- =========================
CREATE OR REPLACE FUNCTION public.api_templates_create(
  p_name text,
  p_labor jsonb,
  p_overhead jsonb,
  p_currency char(3) DEFAULT 'USD'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.templates(tenant_id, name, labor, overhead, currency)
  VALUES (get_user_tenant_id(), p_name, p_labor, p_overhead, p_currency)
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION public.api_template_items_upsert(
  p_template_id uuid,
  p_items jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.template_items(
      id, template_id, item_name, unit, waste_pct, unit_cost, qty_formula, sort_order, active)
    VALUES (
      COALESCE((r->>'id')::uuid, gen_random_uuid()), p_template_id,
      r->>'item_name', r->>'unit',
      COALESCE((r->>'waste_pct')::numeric,0),
      COALESCE((r->>'unit_cost')::numeric,0),
      public.est_sanitize_formula(r->>'qty_formula'),
      COALESCE((r->>'sort_order')::int,0),
      COALESCE((r->>'active')::boolean,true)
    )
    ON CONFLICT (id) DO UPDATE SET
      item_name  = EXCLUDED.item_name,
      unit       = EXCLUDED.unit,
      waste_pct  = EXCLUDED.waste_pct,
      unit_cost  = EXCLUDED.unit_cost,
      qty_formula= EXCLUDED.qty_formula,
      sort_order = EXCLUDED.sort_order,
      active     = EXCLUDED.active,
      updated_at = now();
  END LOOP;
END$$;

CREATE OR REPLACE FUNCTION public.api_estimate_bind_template(
  p_estimate_id uuid,
  p_template_id uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.est_bind_template(p_estimate_id, p_template_id);
$$;

CREATE OR REPLACE FUNCTION public.api_estimate_measurements_upsert(
  p_estimate_id uuid,
  p_payload jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.est_ingest_measurements(p_estimate_id, p_payload);
$$;

CREATE OR REPLACE FUNCTION public.api_estimate_compute_pricing(
  p_estimate_id uuid,
  p_mode text DEFAULT 'margin',
  p_pct numeric DEFAULT 0.30,
  p_currency char(3) DEFAULT 'USD'
) RETURNS TABLE(
  estimate_id uuid,
  currency char(3),
  materials numeric,
  labor numeric,
  overhead numeric,
  cost_pre_profit numeric,
  mode text,
  margin_pct numeric,
  markup_pct numeric,
  sale_price numeric,
  profit numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.est_compute_pricing(p_estimate_id, p_mode, p_pct, p_currency);
$$;

REVOKE ALL ON FUNCTION public.api_templates_create(text,jsonb,jsonb,char) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_template_items_upsert(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_estimate_bind_template(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_estimate_measurements_upsert(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_estimate_compute_pricing(uuid,text,numeric,char) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.api_templates_create(text,jsonb,jsonb,char) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_template_items_upsert(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_estimate_bind_template(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_estimate_measurements_upsert(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_estimate_compute_pricing(uuid,text,numeric,char) TO authenticated;