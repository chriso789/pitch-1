
-- =====================================================================
-- Auto-recalculate change_orders totals from line_items + linked invoices
-- =====================================================================

-- Recompute totals for a single change order
CREATE OR REPLACE FUNCTION public.recalculate_change_order_totals(_co_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_items   jsonb;
  v_li_material  numeric := 0;
  v_li_labor     numeric := 0;
  v_li_overhead  numeric := 0;
  v_inv_material numeric := 0;
  v_inv_labor    numeric := 0;
  v_inv_overhead numeric := 0;
BEGIN
  -- Pull line items off the change order itself
  SELECT line_items INTO v_line_items
  FROM public.change_orders
  WHERE id = _co_id;

  IF v_line_items IS NOT NULL AND jsonb_typeof(v_line_items) = 'array' THEN
    SELECT
      COALESCE(SUM(CASE WHEN lower(COALESCE(li->>'kind','material')) = 'material'
                        THEN COALESCE((li->>'line_total')::numeric,
                                      COALESCE((li->>'quantity')::numeric,0) *
                                      COALESCE((li->>'unit_price')::numeric,0))
                        ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN lower(COALESCE(li->>'kind','')) = 'labor'
                        THEN COALESCE((li->>'line_total')::numeric,
                                      COALESCE((li->>'quantity')::numeric,0) *
                                      COALESCE((li->>'unit_price')::numeric,0))
                        ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN lower(COALESCE(li->>'kind','')) = 'overhead'
                        THEN COALESCE((li->>'line_total')::numeric,
                                      COALESCE((li->>'quantity')::numeric,0) *
                                      COALESCE((li->>'unit_price')::numeric,0))
                        ELSE 0 END),0)
    INTO v_li_material, v_li_labor, v_li_overhead
    FROM jsonb_array_elements(v_line_items) li;
  END IF;

  -- Sum recorded actual-cost invoices linked to this change order
  SELECT
    COALESCE(SUM(CASE WHEN invoice_type = 'material' THEN invoice_amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN invoice_type = 'labor'    THEN invoice_amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN invoice_type = 'overhead' THEN invoice_amount ELSE 0 END),0)
  INTO v_inv_material, v_inv_labor, v_inv_overhead
  FROM public.project_cost_invoices
  WHERE change_order_id = _co_id
    AND COALESCE(status,'pending') IN ('pending','approved','verified');

  -- Persist:
  --   material_total / labor_total = max(planned line items, actual invoices)
  --   cost_impact                  = sum across all categories (rolled up total)
  UPDATE public.change_orders
  SET material_total = GREATEST(v_li_material, v_inv_material),
      labor_total    = GREATEST(v_li_labor,    v_inv_labor),
      cost_impact    = GREATEST(v_li_material, v_inv_material)
                     + GREATEST(v_li_labor,    v_inv_labor)
                     + GREATEST(v_li_overhead, v_inv_overhead),
      updated_at     = now()
  WHERE id = _co_id;
END;
$$;

-- Trigger function for change_orders (when line_items change)
CREATE OR REPLACE FUNCTION public.trg_change_orders_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Skip if our own recalc UPDATE is running (avoid recursion)
    IF NEW.line_items IS NOT DISTINCT FROM OLD.line_items
       AND NEW.material_total IS DISTINCT FROM OLD.material_total THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM public.recalculate_change_order_totals(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS change_orders_recalc_totals ON public.change_orders;
CREATE TRIGGER change_orders_recalc_totals
AFTER INSERT OR UPDATE OF line_items ON public.change_orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_change_orders_recalc();

-- Trigger function for project_cost_invoices
CREATE OR REPLACE FUNCTION public.trg_pci_recalc_change_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.change_order_id IS NOT NULL THEN
      PERFORM public.recalculate_change_order_totals(NEW.change_order_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.change_order_id IS NOT NULL THEN
      PERFORM public.recalculate_change_order_totals(NEW.change_order_id);
    END IF;
    IF OLD.change_order_id IS NOT NULL
       AND OLD.change_order_id IS DISTINCT FROM NEW.change_order_id THEN
      PERFORM public.recalculate_change_order_totals(OLD.change_order_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.change_order_id IS NOT NULL THEN
      PERFORM public.recalculate_change_order_totals(OLD.change_order_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS pci_recalc_change_order_totals ON public.project_cost_invoices;
CREATE TRIGGER pci_recalc_change_order_totals
AFTER INSERT OR UPDATE OR DELETE ON public.project_cost_invoices
FOR EACH ROW
EXECUTE FUNCTION public.trg_pci_recalc_change_order();

-- Backfill: recompute every existing change order so historical rows are correct
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.change_orders LOOP
    PERFORM public.recalculate_change_order_totals(r.id);
  END LOOP;
END $$;
