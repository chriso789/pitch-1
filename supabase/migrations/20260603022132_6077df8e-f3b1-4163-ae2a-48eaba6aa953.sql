
ALTER TABLE public.abc_order_lines
  ADD COLUMN IF NOT EXISTS abc_item_number text,
  ADD COLUMN IF NOT EXISTS abc_item_description text,
  ADD COLUMN IF NOT EXISTS abc_uom text,
  ADD COLUMN IF NOT EXISTS abc_price numeric,
  ADD COLUMN IF NOT EXISTS abc_price_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS abc_branch_number text,
  ADD COLUMN IF NOT EXISTS abc_ship_to_number text,
  ADD COLUMN IF NOT EXISTS abc_price_source text,
  ADD COLUMN IF NOT EXISTS abc_price_override_reason text,
  ADD COLUMN IF NOT EXISTS abc_catalog_payload jsonb;

ALTER TABLE public.abc_orders
  ADD COLUMN IF NOT EXISTS is_sandbox_demo_fallback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jobsite_contact_name text,
  ADD COLUMN IF NOT EXISTS jobsite_contact_email text,
  ADD COLUMN IF NOT EXISTS jobsite_contact_phone text;
