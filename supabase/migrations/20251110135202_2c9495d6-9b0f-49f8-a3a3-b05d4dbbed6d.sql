-- Fix search_path for calculate_price_change_pct function
CREATE OR REPLACE FUNCTION calculate_price_change_pct(old_price NUMERIC, new_price NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  IF old_price IS NULL OR old_price = 0 THEN
    RETURN NULL;
  END IF;
  RETURN ROUND(((new_price - old_price) / old_price * 100)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;