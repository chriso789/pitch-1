-- Fix function search path security issues
-- Update functions to have proper search_path settings

CREATE OR REPLACE FUNCTION public.validate_estimate_min_profit()
RETURNS TRIGGER AS $$
DECLARE
    min_margin DECIMAL(5,2);
    min_amount DECIMAL(10,2);
BEGIN
    -- Only validate on SENT or APPROVED estimates
    IF NEW.status NOT IN ('sent', 'approved') THEN
        RETURN NEW;
    END IF;
    
    -- Get tenant profit policies
    SELECT min_profit_margin_percent, min_profit_amount_dollars
    INTO min_margin, min_amount
    FROM public.tenant_settings
    WHERE tenant_id = NEW.tenant_id;
    
    -- Default values if no settings found
    IF min_margin IS NULL THEN min_margin := 15.00; END IF;
    IF min_amount IS NULL THEN min_amount := 1000.00; END IF;
    
    -- Check minimum profit requirements
    IF NEW.actual_margin_percent < min_margin OR NEW.actual_profit < min_amount THEN
        RAISE EXCEPTION 'Estimate does not meet minimum profit requirements: %.2f%% margin (min %.2f%%) or $%.2f profit (min $%.2f)', 
            NEW.actual_margin_percent, min_margin, NEW.actual_profit, min_amount;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    old_data JSONB;
    new_data JSONB;
    tenant_id_val UUID;
BEGIN
    -- Extract tenant_id from the record
    IF TG_OP = 'DELETE' THEN
        tenant_id_val := OLD.tenant_id;
        old_data := to_jsonb(OLD);
        new_data := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        tenant_id_val := NEW.tenant_id;
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
    ELSIF TG_OP = 'INSERT' THEN
        tenant_id_val := NEW.tenant_id;
        old_data := NULL;
        new_data := to_jsonb(NEW);
    END IF;
    
    -- Insert audit record
    INSERT INTO public.audit_log (
        tenant_id,
        table_name,
        record_id,
        action,
        old_values,
        new_values,
        changed_by,
        changed_at
    ) VALUES (
        tenant_id_val,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        old_data,
        new_data,
        auth.uid(),
        now()
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.create_project_from_estimate()
RETURNS TRIGGER AS $$
DECLARE
    new_project_id UUID;
    project_number_val TEXT;
    contact_record RECORD;
BEGIN
    -- Only trigger on status change to 'approved'
    IF OLD.status != 'approved' AND NEW.status = 'approved' THEN
        
        -- Get contact info for project name
        SELECT * INTO contact_record 
        FROM public.contacts c
        JOIN public.pipeline_entries pe ON pe.contact_id = c.id
        WHERE pe.id = NEW.pipeline_entry_id;
        
        -- Generate project number (simple format: PROJ-YYYY-NNNN)
        project_number_val := 'PROJ-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(NEXTVAL('project_number_seq')::TEXT, 4, '0');
        
        -- Create project
        INSERT INTO public.projects (
            tenant_id,
            pipeline_entry_id,
            project_number,
            name,
            description,
            start_date,
            estimated_completion_date,
            status,
            created_by
        ) VALUES (
            NEW.tenant_id,
            NEW.pipeline_entry_id,
            project_number_val,
            COALESCE(contact_record.first_name || ' ' || contact_record.last_name || ' - ' || contact_record.address_street, 'Project from Estimate #' || NEW.estimate_number),
            'Project created from approved estimate #' || NEW.estimate_number,
            CURRENT_DATE,
            CURRENT_DATE + INTERVAL '30 days', -- Default 30 day project
            'active',
            auth.uid()
        ) RETURNING id INTO new_project_id;
        
        -- Create immutable budget snapshot
        INSERT INTO public.project_budget_snapshots (
            tenant_id,
            project_id,
            estimate_id,
            original_budget,
            is_current,
            created_by
        ) VALUES (
            NEW.tenant_id,
            new_project_id,
            NEW.id,
            jsonb_build_object(
                'estimate_id', NEW.id,
                'estimate_number', NEW.estimate_number,
                'material_cost', NEW.material_cost,
                'labor_cost', NEW.labor_cost,
                'overhead_amount', NEW.overhead_amount,
                'selling_price', NEW.selling_price,
                'actual_profit', NEW.actual_profit,
                'actual_margin_percent', NEW.actual_margin_percent,
                'line_items', NEW.line_items,
                'approved_at', NEW.approved_at
            ),
            true,
            auth.uid()
        );
        
        -- Update pipeline status to 'project'
        UPDATE public.pipeline_entries 
        SET status = 'project', updated_at = now()
        WHERE id = NEW.pipeline_entry_id;
        
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;