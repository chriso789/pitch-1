
ALTER TABLE public.supplier_price_list_items
  ADD COLUMN IF NOT EXISTS pack_quantity numeric,
  ADD COLUMN IF NOT EXISTS pack_uom text;

COMMENT ON COLUMN public.supplier_price_list_items.pack_quantity IS 'Number of pack_uom units contained in one unit_of_measure (e.g., 89 tiles per SQ).';
COMMENT ON COLUMN public.supplier_price_list_items.pack_uom IS 'The smaller invoice unit (e.g., EA / TILE) when unit_of_measure is the bulk unit (e.g., SQ / SQUARE).';

-- Backfill known Brava / Eagle field tile conversion: 89 tiles per square
UPDATE public.supplier_price_list_items
   SET pack_quantity = 89, pack_uom = 'EA'
 WHERE pack_quantity IS NULL
   AND (
     lower(item_description) LIKE '%eagle field tile%'
     OR lower(item_description) LIKE '%brava%field tile%'
     OR lower(normalized_description) LIKE '%eagle field tile%'
   )
   AND upper(coalesce(unit_of_measure, '')) IN ('SQ','SQUARE','SQS','SQUARES');
