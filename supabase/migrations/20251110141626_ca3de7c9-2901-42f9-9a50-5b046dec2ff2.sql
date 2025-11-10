-- Add price lock tracking fields to purchase_order_items
ALTER TABLE public.purchase_order_items
ADD COLUMN IF NOT EXISTS price_locked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS price_fetched_from TEXT, -- 'srs-api', 'cache', 'manual'
ADD COLUMN IF NOT EXISTS price_age_at_lock_hours NUMERIC, -- How old was the price when locked
ADD COLUMN IF NOT EXISTS live_unit_price NUMERIC, -- Latest price at PO creation time
ADD COLUMN IF NOT EXISTS price_variance_pct NUMERIC; -- Percentage difference between cached and live

-- Create index for quick lookup of price-locked items
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_price_locked 
ON public.purchase_order_items(price_locked_at) 
WHERE price_locked_at IS NOT NULL;

COMMENT ON COLUMN public.purchase_order_items.price_locked_at IS 'Timestamp when price was locked at PO creation';
COMMENT ON COLUMN public.purchase_order_items.price_fetched_from IS 'Source of the locked price: srs-api (live), cache, or manual';
COMMENT ON COLUMN public.purchase_order_items.price_age_at_lock_hours IS 'Age of cached price in hours when PO was created';
COMMENT ON COLUMN public.purchase_order_items.live_unit_price IS 'Live price fetched from API at PO creation time (for comparison)';
COMMENT ON COLUMN public.purchase_order_items.price_variance_pct IS 'Percentage difference between cached and live price at lock time';