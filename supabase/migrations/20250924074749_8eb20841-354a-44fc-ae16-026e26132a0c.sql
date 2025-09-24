-- Add trigger to estimates table for automatic versioning
CREATE TRIGGER create_estimate_version_trigger
  AFTER INSERT OR UPDATE ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.create_estimate_version();

-- Create function to rollback estimate to specific version
CREATE OR REPLACE FUNCTION public.rollback_estimate_to_version(
  estimate_id_param UUID,
  version_id_param UUID
) 
RETURNS BOOLEAN AS $$
DECLARE
    version_data JSONB;
    tenant_id_val UUID;
BEGIN
    -- Get the version data and tenant validation
    SELECT ev.snapshot_data, ev.tenant_id 
    INTO version_data, tenant_id_val
    FROM public.estimate_versions ev
    WHERE ev.id = version_id_param 
    AND ev.estimate_id = estimate_id_param
    AND ev.tenant_id = get_user_tenant_id();
    
    IF version_data IS NULL THEN
        RAISE EXCEPTION 'Version not found or access denied';
    END IF;
    
    -- Update estimate with version data (this will trigger new version creation)
    UPDATE public.estimates SET
        estimate_number = (version_data->>'estimate_number')::TEXT,
        status = (version_data->>'status')::estimate_status,
        selling_price = (version_data->>'selling_price')::NUMERIC,
        material_cost = (version_data->>'material_cost')::NUMERIC,
        labor_cost = (version_data->>'labor_cost')::NUMERIC,
        overhead_amount = (version_data->>'overhead_amount')::NUMERIC,
        overhead_percent = (version_data->>'overhead_percent')::NUMERIC,
        target_margin_percent = (version_data->>'target_margin_percent')::NUMERIC,
        actual_margin_percent = (version_data->>'actual_margin_percent')::NUMERIC,
        actual_profit = (version_data->>'actual_profit')::NUMERIC,
        line_items = (version_data->'line_items'),
        parameters = (version_data->'parameters'),
        valid_until = (version_data->>'valid_until')::DATE,
        updated_at = now()
    WHERE id = estimate_id_param 
    AND tenant_id = get_user_tenant_id();
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;