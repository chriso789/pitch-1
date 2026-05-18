
-- 1) Per-user, per-supplier default branch codes (e.g. { "srs": "521", "qxo": "BR-12" })
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_supplier_branches jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Per-line-item "requires color" flag on the materials template editor.
--    When true and the color isn't filled in on the estimate line item,
--    pushing the order to the supplier is blocked.
ALTER TABLE public.estimate_calc_template_items
  ADD COLUMN IF NOT EXISTS requires_color boolean NOT NULL DEFAULT false;
