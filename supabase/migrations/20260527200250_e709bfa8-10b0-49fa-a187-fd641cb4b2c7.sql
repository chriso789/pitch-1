
CREATE OR REPLACE FUNCTION public.compute_co_totals_from_line_items(p_line_items jsonb)
RETURNS TABLE(material_total numeric, labor_total numeric, cost_impact numeric)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_mat numeric := 0;
  v_lab numeric := 0;
  v_line numeric := 0;
  v_qty numeric;
  v_price numeric;
  v_kind text;
  v_items jsonb;
  v_overhead numeric := 0;
  v_profit numeric := 0;
  v_subtotal numeric := 0;
  rec jsonb;
BEGIN
  IF p_line_items IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  -- Support two shapes: top-level array, OR object {items:[], overhead_amount, profit_amount, subtotal}
  IF jsonb_typeof(p_line_items) = 'array' THEN
    v_items := p_line_items;
  ELSIF jsonb_typeof(p_line_items) = 'object' THEN
    v_items := COALESCE(p_line_items->'items', '[]'::jsonb);
    v_overhead := COALESCE((p_line_items->>'overhead_amount')::numeric, 0);
    v_profit := COALESCE((p_line_items->>'profit_amount')::numeric, 0);
    v_subtotal := COALESCE((p_line_items->>'subtotal')::numeric, 0);
  ELSE
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := COALESCE((rec->>'qty')::numeric, (rec->>'quantity')::numeric, 0);
    v_price := COALESCE(
      (rec->>'unit_cost')::numeric,
      (rec->>'unit_price')::numeric,
      (rec->>'price')::numeric,
      (rec->>'rate')::numeric,
      0
    );
    v_line := COALESCE(
      (rec->>'line_total')::numeric,
      (rec->>'total')::numeric,
      (rec->>'amount')::numeric,
      v_qty * v_price
    );
    v_kind := LOWER(COALESCE(rec->>'kind', rec->>'type', rec->>'category', 'material'));
    IF v_kind IN ('labor','service') THEN
      v_lab := v_lab + v_line;
    ELSE
      v_mat := v_mat + v_line;
    END IF;
  END LOOP;

  -- cost_impact (selling price) = items + overhead + profit (object shape).
  -- For array shape, overhead/profit are 0.
  RETURN QUERY SELECT v_mat, v_lab, (v_mat + v_lab + v_overhead + v_profit);
END;
$$;

-- Re-backfill all relevant rows
UPDATE public.change_orders
SET line_items = line_items
WHERE line_items IS NOT NULL
  AND jsonb_typeof(line_items) IN ('array','object');

NOTIFY pgrst, 'reload schema';
