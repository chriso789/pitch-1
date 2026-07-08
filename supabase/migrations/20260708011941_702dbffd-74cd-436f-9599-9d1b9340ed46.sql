
-- Allow 'turnkey' in estimate calc template groups and items so AI-generated
-- estimate details include turnkey line items alongside material/labor.

ALTER TABLE public.estimate_calc_template_groups
  DROP CONSTRAINT IF EXISTS estimate_calc_template_groups_group_type_check;

ALTER TABLE public.estimate_calc_template_groups
  ADD CONSTRAINT estimate_calc_template_groups_group_type_check
  CHECK (group_type IN ('material', 'labor', 'turnkey'));

ALTER TABLE public.estimate_calc_template_items
  DROP CONSTRAINT IF EXISTS estimate_calc_template_items_item_type_check;

ALTER TABLE public.estimate_calc_template_items
  ADD CONSTRAINT estimate_calc_template_items_item_type_check
  CHECK (item_type IN ('material', 'labor', 'turnkey'));
