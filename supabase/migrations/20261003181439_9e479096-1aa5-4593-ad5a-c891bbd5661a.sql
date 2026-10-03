CREATE OR REPLACE FUNCTION public.remove_change_order_from_estimates(_co_id uuid, _mat numeric DEFAULT 0, _lab numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_sell_sub numeric; v_found int; v_mat jsonb; v_lab jsonb; v_sell numeric; v_pre numeric; v_oh numeric; v_m numeric; v_l numeric;
BEGIN
  FOR r IN SELECT id, line_items, selling_price, material_cost, labor_cost, overhead_percent, sales_tax_amount
           FROM enhanced_estimates WHERE line_items::text LIKE '%' || _co_id::text || '%'
  LOOP
    SELECT count(*), COALESCE(sum(COALESCE((x->>'co_selling_amount')::numeric,
                     CASE WHEN x ? 'co_selling_amount' OR x ? 'co_line' THEN 0 ELSE (x->>'line_total')::numeric END)),0)
      INTO v_found, v_sell_sub
      FROM (SELECT jsonb_array_elements(COALESCE(r.line_items->'materials','[]'::jsonb)) x
            UNION ALL SELECT jsonb_array_elements(COALESCE(r.line_items->'labor','[]'::jsonb))) s
      WHERE x->>'source_change_order_id' = _co_id::text;
    IF v_found = 0 THEN CONTINUE; END IF;

    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_mat FROM jsonb_array_elements(COALESCE(r.line_items->'materials','[]'::jsonb)) x WHERE COALESCE(x->>'source_change_order_id','') <> _co_id::text;
    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_lab FROM jsonb_array_elements(COALESCE(r.line_items->'labor','[]'::jsonb)) x WHERE COALESCE(x->>'source_change_order_id','') <> _co_id::text;

    v_sell := GREATEST(0, COALESCE(r.selling_price,0) - v_sell_sub);
    v_m := GREATEST(0, COALESCE(r.material_cost,0) - COALESCE(_mat,0));
    v_l := GREATEST(0, COALESCE(r.labor_cost,0) - COALESCE(_lab,0));
    v_pre := v_sell - COALESCE(r.sales_tax_amount,0);
    v_oh := round(v_pre * COALESCE(r.overhead_percent,0) / 100, 2);
    UPDATE enhanced_estimates SET
      line_items = jsonb_set(jsonb_set(COALESCE(line_items,'{}'::jsonb), '{materials}', v_mat), '{labor}', v_lab),
      selling_price = v_sell, material_cost = v_m, labor_cost = v_l, overhead_amount = v_oh,
      actual_profit_amount = round(v_pre - v_m - v_l - v_oh, 2),
      actual_profit_percent = CASE WHEN v_pre > 0 THEN round((v_pre - v_m - v_l - v_oh) / v_pre * 100, 2) ELSE 0 END
    WHERE id = r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.add_change_order_to_estimate(_co_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE co record; v_pe uuid; v_sel uuid; est record; v_amount numeric; v_items jsonb; v_mat_adds jsonb := '[]'::jsonb; v_lab_adds jsonb := '[]'::jsonb;
  it jsonb; v_qty numeric; v_price numeric; v_total numeric; v_first boolean := true; v_row jsonb;
  v_sell numeric; v_m numeric; v_l numeric; v_pre numeric; v_oh numeric;
BEGIN
  SELECT * INTO co FROM change_orders WHERE id = _co_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- already merged somewhere? skip
  IF EXISTS (SELECT 1 FROM enhanced_estimates WHERE line_items::text LIKE '%' || _co_id::text || '%') THEN RETURN; END IF;

  SELECT pipeline_entry_id INTO v_pe FROM projects WHERE id = co.project_id;
  IF v_pe IS NULL THEN RETURN; END IF;
  SELECT NULLIF(metadata->>'selected_estimate_id','')::uuid INTO v_sel FROM pipeline_entries WHERE id = v_pe;
  IF v_sel IS NOT NULL THEN
    SELECT * INTO est FROM enhanced_estimates WHERE id = v_sel;
  END IF;
  IF est.id IS NULL THEN
    SELECT * INTO est FROM enhanced_estimates WHERE pipeline_entry_id = v_pe ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF est.id IS NULL THEN RETURN; END IF;

  v_items := COALESCE(co.line_items->'items','[]'::jsonb);
  IF COALESCE(co.line_items->>'pricing_mode','') = 'fixed' OR COALESCE((co.line_items->>'fixed_price')::numeric,0) > 0 THEN
    v_amount := COALESCE((co.line_items->>'fixed_price')::numeric, co.cost_impact, 0);
  ELSE
    v_amount := COALESCE(co.cost_impact, 0);
  END IF;
  IF v_amount <= 0 THEN RETURN; END IF;

  IF jsonb_array_length(v_items) > 0 THEN
    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_qty := COALESCE(NULLIF(it->>'quantity','')::numeric, NULLIF(it->>'qty','')::numeric, 1);
      v_price := COALESCE(NULLIF(it->>'unit_price','')::numeric, NULLIF(it->>'price','')::numeric, NULLIF(it->>'rate','')::numeric, 0);
      v_total := COALESCE(NULLIF(it->>'line_total','')::numeric, NULLIF(it->>'total','')::numeric, v_qty * v_price);
      v_row := jsonb_build_object(
        'description', '[' || co.co_number || '] ' || COALESCE(NULLIF(it->>'description',''), NULLIF(it->>'name',''), NULLIF(it->>'item_name',''), co.title),
        'quantity', v_qty, 'unit_price', v_price, 'line_total', v_total,
        'source_change_order_id', co.id, 'change_order_number', co.co_number,
        'is_change_order', true, 'co_line', true,
        'section_label', 'Change Order ' || co.co_number);
      IF v_first THEN v_row := v_row || jsonb_build_object('co_selling_amount', v_amount); v_first := false; END IF;
      IF lower(COALESCE(it->>'kind', it->>'category', 'material')) LIKE 'lab%' THEN
        v_lab_adds := v_lab_adds || jsonb_build_array(v_row);
      ELSE
        v_mat_adds := v_mat_adds || jsonb_build_array(v_row);
      END IF;
    END LOOP;
  ELSE
    v_mat_adds := jsonb_build_array(jsonb_build_object(
      'description', '[' || co.co_number || '] ' || COALESCE(co.title,'Change order'),
      'quantity', 1, 'unit_price', v_amount, 'line_total', v_amount,
      'source_change_order_id', co.id, 'change_order_number', co.co_number,
      'is_change_order', true, 'co_line', true, 'co_selling_amount', v_amount,
      'section_label', 'Change Order ' || co.co_number));
  END IF;

  v_sell := COALESCE(est.selling_price,0) + v_amount;
  v_m := COALESCE(est.material_cost,0) + COALESCE(co.material_total,0);
  v_l := COALESCE(est.labor_cost,0) + COALESCE(co.labor_total,0);
  v_pre := v_sell - COALESCE(est.sales_tax_amount,0);
  v_oh := round(v_pre * COALESCE(est.overhead_percent,0) / 100, 2);

  UPDATE enhanced_estimates SET
    line_items = jsonb_set(jsonb_set(COALESCE(line_items,'{}'::jsonb),
      '{materials}', COALESCE(line_items->'materials','[]'::jsonb) || v_mat_adds),
      '{labor}', COALESCE(line_items->'labor','[]'::jsonb) || v_lab_adds),
    selling_price = v_sell, material_cost = v_m, labor_cost = v_l, overhead_amount = v_oh,
    actual_profit_amount = round(v_pre - v_m - v_l - v_oh, 2),
    actual_profit_percent = CASE WHEN v_pre > 0 THEN round((v_pre - v_m - v_l - v_oh) / v_pre * 100, 2) ELSE 0 END
  WHERE id = est.id;
END $$;

CREATE OR REPLACE FUNCTION public.trg_change_orders_sync_estimate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_ok boolean; v_old_ok boolean := false;
BEGIN
  v_new_ok := lower(COALESCE(NEW.status,'')) IN ('approved','invoiced','completed') OR COALESCE(NEW.customer_approved,false);
  IF lower(COALESCE(NEW.status,'')) IN ('rejected','void','cancelled','canceled','draft') THEN v_new_ok := false; END IF;
  IF TG_OP = 'UPDATE' THEN
    -- take the old version off first so edits re-apply cleanly
    PERFORM public.remove_change_order_from_estimates(OLD.id, COALESCE(OLD.material_total,0), COALESCE(OLD.labor_total,0));
  END IF;
  IF v_new_ok THEN
    PERFORM public.add_change_order_to_estimate(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS change_orders_sync_estimate ON public.change_orders;
CREATE TRIGGER change_orders_sync_estimate
AFTER INSERT OR UPDATE OF status, customer_approved, cost_impact, line_items, material_total, labor_total, title ON public.change_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_change_orders_sync_estimate();

REVOKE ALL ON FUNCTION public.add_change_order_to_estimate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_change_order_from_estimates(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_change_orders_sync_estimate() FROM PUBLIC, anon, authenticated;

-- Apply to currently approved change orders not yet in an estimate
DO $$ DECLARE c uuid; BEGIN
  FOR c IN SELECT id FROM change_orders
    WHERE (lower(COALESCE(status,'')) IN ('approved','completed') OR COALESCE(customer_approved,false))
      AND lower(COALESCE(status,'')) NOT IN ('rejected','void','cancelled','canceled','draft','invoiced')
      AND created_at > now() - interval '1 day'
  LOOP PERFORM public.add_change_order_to_estimate(c); END LOOP;
END $$;