-- Create functions for profit validation and audit triggers
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
$$ LANGUAGE plpgsql;

-- Create trigger for profit validation
CREATE TRIGGER estimate_profit_validation
BEFORE UPDATE ON public.estimates
FOR EACH ROW
EXECUTE FUNCTION public.validate_estimate_min_profit();

-- Create audit trigger function
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
$$ LANGUAGE plpgsql;

-- Create audit triggers for key tables
CREATE TRIGGER audit_contacts AFTER INSERT OR UPDATE OR DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_pipeline_entries AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE OR DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_estimates AFTER INSERT OR UPDATE OR DELETE ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- Function to create project from approved estimate (business logic)
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
$$ LANGUAGE plpgsql;

-- Create sequence for project numbers
CREATE SEQUENCE IF NOT EXISTS project_number_seq START 1;

-- Create trigger for automatic project creation
CREATE TRIGGER estimate_approved_create_project
AFTER UPDATE ON public.estimates
FOR EACH ROW
EXECUTE FUNCTION public.create_project_from_estimate();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create update timestamp triggers for all relevant tables
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tenant_settings_updated_at BEFORE UPDATE ON public.tenant_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pipeline_entries_updated_at BEFORE UPDATE ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_project_costs_updated_at BEFORE UPDATE ON public.project_costs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_rep_overhead_rules_updated_at BEFORE UPDATE ON public.rep_overhead_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_commission_plans_updated_at BEFORE UPDATE ON public.commission_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_commission_plans_updated_at BEFORE UPDATE ON public.user_commission_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_outbox_events_updated_at BEFORE UPDATE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_portal_access_grants_updated_at BEFORE UPDATE ON public.portal_access_grants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();