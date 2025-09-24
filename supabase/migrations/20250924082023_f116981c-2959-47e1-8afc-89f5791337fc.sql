-- Subcontractor Management Tables
CREATE TABLE public.subcontractors (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_name TEXT NOT NULL,
    trade TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address_street TEXT,
    address_city TEXT,
    address_state TEXT,
    address_zip TEXT,
    w9_url TEXT,
    insurance_expiry_date DATE,
    license_number TEXT,
    license_expiry_date DATE,
    rating DECIMAL(3,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.subcontractor_capacity (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    subcontractor_id UUID NOT NULL,
    date DATE NOT NULL,
    available_slots INTEGER NOT NULL DEFAULT 1,
    booked_slots INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, subcontractor_id, date)
);

CREATE TABLE public.subcontractor_jobs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    subcontractor_id UUID NOT NULL,
    project_id UUID NOT NULL,
    task_id UUID,
    trade TEXT NOT NULL,
    scheduled_date DATE,
    actual_start_date DATE,
    actual_end_date DATE,
    status TEXT NOT NULL DEFAULT 'scheduled',
    cost DECIMAL(10,2),
    rating DECIMAL(3,2),
    feedback TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Photo Documentation Tables
CREATE TABLE public.project_photos (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    task_id UUID,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    gps_accuracy DECIMAL(6, 2),
    capture_timestamp TIMESTAMP WITH TIME ZONE,
    workflow_status TEXT NOT NULL DEFAULT 'captured',
    ai_tags TEXT[],
    ai_description TEXT,
    qc_approved_by UUID,
    qc_approved_at TIMESTAMP WITH TIME ZONE,
    qc_notes TEXT,
    uploaded_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Quality Control Tables
CREATE TABLE public.qc_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    roof_type TEXT NOT NULL,
    template_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.qc_inspections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    template_id UUID NOT NULL,
    inspector_id UUID NOT NULL,
    inspection_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    overall_score DECIMAL(5,2),
    status TEXT NOT NULL DEFAULT 'in_progress',
    critical_failures INTEGER DEFAULT 0,
    total_items INTEGER DEFAULT 0,
    passed_items INTEGER DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    report_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractor_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractor_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Subcontractors
CREATE POLICY "Users can view subcontractors in their tenant" ON public.subcontractors
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage subcontractors in their tenant" ON public.subcontractors
    FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for Subcontractor Capacity
CREATE POLICY "Users can view capacity in their tenant" ON public.subcontractor_capacity
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage capacity in their tenant" ON public.subcontractor_capacity
    FOR ALL USING (tenant_id = get_user_tenant_id());

-- RLS Policies for Subcontractor Jobs
CREATE POLICY "Users can view sub jobs in their tenant" ON public.subcontractor_jobs
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage sub jobs in their tenant" ON public.subcontractor_jobs
    FOR ALL USING (tenant_id = get_user_tenant_id());

-- RLS Policies for Project Photos
CREATE POLICY "Users can view photos in their tenant" ON public.project_photos
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage photos in their tenant" ON public.project_photos
    FOR ALL USING (tenant_id = get_user_tenant_id());

-- RLS Policies for QC Templates
CREATE POLICY "Users can view QC templates in their tenant" ON public.qc_templates
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage QC templates in their tenant" ON public.qc_templates
    FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for QC Inspections
CREATE POLICY "Users can view QC inspections in their tenant" ON public.qc_inspections
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage QC inspections in their tenant" ON public.qc_inspections
    FOR ALL USING (tenant_id = get_user_tenant_id());

-- Indexes for performance
CREATE INDEX idx_subcontractors_tenant_trade ON public.subcontractors(tenant_id, trade);
CREATE INDEX idx_subcontractor_capacity_date ON public.subcontractor_capacity(tenant_id, subcontractor_id, date);
CREATE INDEX idx_subcontractor_jobs_project ON public.subcontractor_jobs(tenant_id, project_id);
CREATE INDEX idx_project_photos_project ON public.project_photos(tenant_id, project_id);
CREATE INDEX idx_project_photos_task ON public.project_photos(tenant_id, task_id);
CREATE INDEX idx_project_photos_workflow ON public.project_photos(tenant_id, workflow_status);
CREATE INDEX idx_qc_inspections_project ON public.qc_inspections(tenant_id, project_id);

-- Triggers for updated_at
CREATE TRIGGER update_subcontractors_updated_at
    BEFORE UPDATE ON public.subcontractors
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subcontractor_capacity_updated_at
    BEFORE UPDATE ON public.subcontractor_capacity
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subcontractor_jobs_updated_at
    BEFORE UPDATE ON public.subcontractor_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_photos_updated_at
    BEFORE UPDATE ON public.project_photos
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_qc_templates_updated_at
    BEFORE UPDATE ON public.qc_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_qc_inspections_updated_at
    BEFORE UPDATE ON public.qc_inspections
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check subcontractor capacity
CREATE OR REPLACE FUNCTION public.check_subcontractor_capacity(
    sub_id UUID,
    check_date DATE,
    tenant_id_param UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    available_slots INTEGER;
    booked_slots INTEGER;
BEGIN
    SELECT sc.available_slots, sc.booked_slots
    INTO available_slots, booked_slots
    FROM public.subcontractor_capacity sc
    WHERE sc.subcontractor_id = sub_id
    AND sc.date = check_date
    AND sc.tenant_id = tenant_id_param;
    
    IF available_slots IS NULL THEN
        -- No capacity record exists, assume 1 slot available
        RETURN true;
    END IF;
    
    RETURN booked_slots < available_slots;
END;
$$;

-- Function to auto-alert on expiring documents
CREATE OR REPLACE FUNCTION public.check_subcontractor_compliance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if insurance or license is expiring within 30 days
    IF (NEW.insurance_expiry_date IS NOT NULL AND NEW.insurance_expiry_date <= CURRENT_DATE + INTERVAL '30 days') OR
       (NEW.license_expiry_date IS NOT NULL AND NEW.license_expiry_date <= CURRENT_DATE + INTERVAL '30 days') THEN
        
        -- Insert alert into AI insights
        INSERT INTO public.ai_insights (
            tenant_id,
            context_type,
            context_id,
            insight_type,
            title,
            description,
            priority,
            metadata
        ) VALUES (
            NEW.tenant_id,
            'subcontractor',
            NEW.id,
            'compliance_alert',
            'Subcontractor Documents Expiring',
            'Insurance or license documents for ' || NEW.company_name || ' are expiring within 30 days.',
            'high',
            jsonb_build_object(
                'company_name', NEW.company_name,
                'insurance_expiry', NEW.insurance_expiry_date,
                'license_expiry', NEW.license_expiry_date
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER subcontractor_compliance_check
    AFTER INSERT OR UPDATE ON public.subcontractors
    FOR EACH ROW
    EXECUTE FUNCTION public.check_subcontractor_compliance();