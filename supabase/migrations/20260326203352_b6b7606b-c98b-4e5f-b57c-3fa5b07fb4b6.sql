
-- Add validation trigger for actual_profit_percent on enhanced_estimates
-- Using a trigger instead of CHECK constraint per Supabase best practices
CREATE OR REPLACE FUNCTION public.validate_profit_percent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actual_profit_percent IS NOT NULL AND (NEW.actual_profit_percent < -100 OR NEW.actual_profit_percent > 85) THEN
    RAISE EXCEPTION 'actual_profit_percent must be between -100 and 85, got %', NEW.actual_profit_percent;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_profit_percent ON public.enhanced_estimates;
CREATE TRIGGER trg_validate_profit_percent
  BEFORE INSERT OR UPDATE ON public.enhanced_estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profit_percent();
