
ALTER TABLE public.srs_orders
  ADD COLUMN IF NOT EXISTS baseline_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS baseline_lock_reason text,
  ADD COLUMN IF NOT EXISTS baseline_supplier text;

CREATE TABLE IF NOT EXISTS public.srs_order_baseline_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.srs_orders(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  lock_reason text NOT NULL,
  supplier text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.srs_order_baseline_snapshots TO authenticated;
GRANT ALL ON public.srs_order_baseline_snapshots TO service_role;

ALTER TABLE public.srs_order_baseline_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read srs baseline snapshots" ON public.srs_order_baseline_snapshots;
CREATE POLICY "Tenant members can read srs baseline snapshots"
  ON public.srs_order_baseline_snapshots
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
      AND uca.tenant_id::text = srs_order_baseline_snapshots.tenant_id
      AND uca.is_active = true
  ));

CREATE INDEX IF NOT EXISTS idx_srs_baseline_snapshots_order ON public.srs_order_baseline_snapshots(order_id);
CREATE INDEX IF NOT EXISTS idx_srs_baseline_snapshots_tenant ON public.srs_order_baseline_snapshots(tenant_id);

-- Auto-lock for purchase_orders
CREATE OR REPLACE FUNCTION public.auto_lock_purchase_order_baseline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_reason text;
  v_old_status text := lower(coalesce(OLD.status, ''));
  v_new_status text := lower(coalesce(NEW.status, ''));
  v_unlocked_states constant text[] := ARRAY['draft','pending','pending_approval','queued',''];
BEGIN
  IF NEW.baseline_locked_at IS NOT NULL THEN RETURN NEW; END IF;
  IF v_new_status = v_old_status THEN RETURN NEW; END IF;
  IF v_new_status = ANY(v_unlocked_states) THEN RETURN NEW; END IF;
  IF NOT (v_old_status = ANY(v_unlocked_states)) THEN RETURN NEW; END IF;

  v_reason := 'status_transition:' || v_new_status;

  NEW.baseline_locked_at := now();
  NEW.baseline_lock_reason := v_reason;

  SELECT jsonb_agg(jsonb_build_object(
    'item_id', poi.id,
    'srs_item_code', poi.srs_item_code,
    'description', poi.item_description,
    'quantity', poi.quantity,
    'unit_price', poi.unit_price,
    'line_total', poi.line_total
  ))
  INTO v_snapshot
  FROM public.purchase_order_items poi
  WHERE poi.po_id = NEW.id;

  INSERT INTO public.purchase_order_baseline_snapshots(po_id, tenant_id, lock_reason, supplier, snapshot)
  VALUES (
    NEW.id,
    coalesce(NEW.tenant_id::text, ''),
    v_reason,
    coalesce(NEW.baseline_supplier, 'unknown'),
    coalesce(v_snapshot, '[]'::jsonb)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_lock_po_baseline ON public.purchase_orders;
CREATE TRIGGER trg_auto_lock_po_baseline
  BEFORE UPDATE OF status ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_lock_purchase_order_baseline();

-- Auto-lock for srs_orders
CREATE OR REPLACE FUNCTION public.auto_lock_srs_order_baseline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_reason text;
  v_old_status text := lower(coalesce(OLD.status, ''));
  v_new_status text := lower(coalesce(NEW.status, ''));
  v_unlocked_states constant text[] := ARRAY['draft','pending','queued',''];
BEGIN
  IF NEW.baseline_locked_at IS NOT NULL THEN RETURN NEW; END IF;
  IF v_new_status = v_old_status THEN RETURN NEW; END IF;
  IF v_new_status = ANY(v_unlocked_states) THEN RETURN NEW; END IF;
  IF NOT (v_old_status = ANY(v_unlocked_states)) THEN RETURN NEW; END IF;

  v_reason := 'status_transition:' || v_new_status;

  NEW.baseline_locked_at := now();
  NEW.baseline_lock_reason := v_reason;
  NEW.baseline_supplier := coalesce(NEW.baseline_supplier, 'srs');

  SELECT jsonb_agg(jsonb_build_object(
    'item_id', soi.id,
    'srs_product_id', soi.srs_product_id,
    'product_name', soi.product_name,
    'quantity', soi.quantity,
    'unit_price', soi.unit_price,
    'total_price', soi.total_price
  ))
  INTO v_snapshot
  FROM public.srs_order_items soi
  WHERE soi.order_id = NEW.id;

  INSERT INTO public.srs_order_baseline_snapshots(order_id, tenant_id, lock_reason, supplier, snapshot)
  VALUES (
    NEW.id,
    coalesce(NEW.tenant_id, ''),
    v_reason,
    coalesce(NEW.baseline_supplier, 'srs'),
    coalesce(v_snapshot, '[]'::jsonb)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_lock_srs_baseline ON public.srs_orders;
CREATE TRIGGER trg_auto_lock_srs_baseline
  BEFORE UPDATE OF status ON public.srs_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_lock_srs_order_baseline();

NOTIFY pgrst, 'reload schema';
