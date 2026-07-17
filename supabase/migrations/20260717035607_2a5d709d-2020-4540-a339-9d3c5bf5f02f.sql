ALTER TABLE public.srs_order_items
  ADD COLUMN IF NOT EXISTS product_option text,
  ADD COLUMN IF NOT EXISTS product_color text;

COMMENT ON COLUMN public.srs_order_items.product_option IS 'Variant selector sent to SRS as orderLineItemDetails.option (usually the color/style name from productVariant[].selectedOption or colorName).';
COMMENT ON COLUMN public.srs_order_items.product_color IS 'Human-readable color name for display and reconciliation.';