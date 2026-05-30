
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS abc_price numeric,
  ADD COLUMN IF NOT EXISTS abc_price_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS abc_branch text,
  ADD COLUMN IF NOT EXISTS abc_ship_to text,
  ADD COLUMN IF NOT EXISTS abc_availability text,
  ADD COLUMN IF NOT EXISTS abc_price_status text;

COMMENT ON COLUMN public.estimate_line_items.abc_price_status IS
  'ABC pricing result for this line: priced | unavailable | zero | error | null (not yet quoted).';
