CREATE OR REPLACE FUNCTION public.remove_change_order_from_estimates(_co_id uuid, _mat numeric DEFAULT 0, _lab numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_sell_sub numeric; v_mat jsonb; v_lab jsonb; v_sell numeric; v_pre numeric; v_oh numeric; v_m numeric; v_l numeric;
BEGIN
  FOR r IN SELECT id, line_items, selling_price, material_cost, labor_cost, overhead_percent, sales_tax_amount
           FROM enhanced_estimates
           WHERE line_items::text LIKE '%' || _co_id::text || '%'
  LOOP
    SELECT COALESCE(sum((x->>'line_total')::numeric),0) INTO v_sell_sub
      FROM (SELECT jsonb_array_elements(COALESCE(r.line_items->'materials','[]'::jsonb)) x
            UNION ALL SELECT jsonb_array_elements(COALESCE(r.line_items->'labor','[]'::jsonb))) s
      WHERE x->>'source_change_order_id' = _co_id::text;
    IF v_sell_sub = 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(r.line_items->'materials','[]'::jsonb)) x WHERE x->>'source_change_order_id' = _co_id::text
      UNION ALL SELECT 1 FROM jsonb_array_elements(COALESCE(r.line_items->'labor','[]'::jsonb)) x WHERE x->>'source_change_order_id' = _co_id::text
    ) THEN CONTINUE; END IF;

    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_mat FROM jsonb_array_elements(COALESCE(r.line_items->'materials','[]'::jsonb)) x WHERE COALESCE(x->>'source_change_order_id','') <> _co_id::text;
    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_lab FROM jsonb_array_elements(COALESCE(r.line_items->'labor','[]'::jsonb)) x WHERE COALESCE(x->>'source_change_order_id','') <> _co_id::text;

    v_sell := GREATEST(0, COALESCE(r.selling_price,0) - v_sell_sub);
    v_m := GREATEST(0, COALESCE(r.material_cost,0) - COALESCE(_mat,0));
    v_l := GREATEST(0, COALESCE(r.labor_cost,0) - COALESCE(_lab,0));
    v_pre := v_sell - COALESCE(r.sales_tax_amount,0);
    v_oh := round(v_pre * COALESCE(r.overhead_percent,0) / 100, 2);

    UPDATE enhanced_estimates SET
      line_items = jsonb_set(jsonb_set(line_items, '{materials}', v_mat), '{labor}', v_lab),
      selling_price = v_sell,
      material_cost = v_m,
      labor_cost = v_l,
      overhead_amount = v_oh,
      actual_profit_amount = round(v_pre - v_m - v_l - v_oh, 2),
      actual_profit_percent = CASE WHEN v_pre > 0 THEN round((v_pre - v_m - v_l - v_oh) / v_pre * 100, 2) ELSE 0 END
    WHERE id = r.id;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.remove_change_order_from_estimates(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_change_orders_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.remove_change_order_from_estimates(OLD.id, COALESCE(OLD.material_total,0), COALESCE(OLD.labor_total,0));
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS change_orders_remove_from_estimate ON public.change_orders;
CREATE TRIGGER change_orders_remove_from_estimate
AFTER DELETE ON public.change_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_change_orders_on_delete();

-- One-time cleanup of lines left behind by already-deleted change orders
DO $$
DECLARE c uuid;
BEGIN
  FOR c IN
    SELECT DISTINCT (x->>'source_change_order_id')::uuid
    FROM enhanced_estimates e,
         LATERAL (SELECT jsonb_array_elements(COALESCE(e.line_items->'materials','[]'::jsonb)) x
                  UNION ALL SELECT jsonb_array_elements(COALESCE(e.line_items->'labor','[]'::jsonb))) s
    WHERE x ? 'source_change_order_id'
      AND (x->>'source_change_order_id') ~ '^[0-9a-f-]{36}$'
      AND NOT EXISTS (SELECT 1 FROM change_orders co WHERE co.id = (x->>'source_change_order_id')::uuid)
  LOOP
    PERFORM public.remove_change_order_from_estimates(c, 0, 0);
  END LOOP;
END $$;