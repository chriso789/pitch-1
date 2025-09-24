-- Create estimate versions table for full history tracking
CREATE TABLE public.estimate_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot_data JSONB NOT NULL,
  change_reason TEXT,
  changes_summary JSONB DEFAULT '[]'::jsonb,
  previous_version_id UUID,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_current BOOLEAN NOT NULL DEFAULT false,
  
  -- Composite unique constraint to prevent duplicate versions
  UNIQUE(estimate_id, version_number)
);

-- Enable RLS
ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view estimate versions in their tenant" 
ON public.estimate_versions 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create estimate versions in their tenant" 
ON public.estimate_versions 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "System can update estimate versions in tenant" 
ON public.estimate_versions 
FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

-- Create estimate approval workflow table
CREATE TABLE public.estimate_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL,
  estimate_version_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id UUID,
  approval_notes TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT estimate_approval_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Enable RLS
ALTER TABLE public.estimate_approvals ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view estimate approvals in their tenant" 
ON public.estimate_approvals 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage estimate approvals in their tenant" 
ON public.estimate_approvals 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- Create indexes for performance
CREATE INDEX idx_estimate_versions_tenant ON public.estimate_versions(tenant_id);
CREATE INDEX idx_estimate_versions_estimate ON public.estimate_versions(estimate_id);
CREATE INDEX idx_estimate_versions_current ON public.estimate_versions(estimate_id, is_current) WHERE is_current = true;
CREATE INDEX idx_estimate_approvals_tenant ON public.estimate_approvals(tenant_id);
CREATE INDEX idx_estimate_approvals_estimate ON public.estimate_approvals(estimate_id);

-- Create triggers
CREATE TRIGGER update_estimate_approvals_updated_at
  BEFORE UPDATE ON public.estimate_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to auto-version estimates
CREATE OR REPLACE FUNCTION public.create_estimate_version()
RETURNS TRIGGER AS $$
DECLARE
    next_version_number INTEGER;
    previous_version_id UUID;
BEGIN
    -- Only create version on significant changes (not every update)
    IF TG_OP = 'UPDATE' AND (
        OLD.status != NEW.status OR
        OLD.selling_price != NEW.selling_price OR
        OLD.line_items != NEW.line_items OR
        OLD.material_cost != NEW.material_cost OR
        OLD.labor_cost != NEW.labor_cost OR
        OLD.overhead_amount != NEW.overhead_amount OR
        OLD.target_margin_percent != NEW.target_margin_percent
    ) THEN
        -- Get the next version number
        SELECT COALESCE(MAX(version_number), 0) + 1 
        INTO next_version_number
        FROM public.estimate_versions 
        WHERE estimate_id = NEW.id;
        
        -- Get previous version ID
        SELECT id INTO previous_version_id
        FROM public.estimate_versions 
        WHERE estimate_id = NEW.id AND is_current = true;
        
        -- Mark all existing versions as not current
        UPDATE public.estimate_versions 
        SET is_current = false 
        WHERE estimate_id = NEW.id;
        
        -- Create new version snapshot
        INSERT INTO public.estimate_versions (
            tenant_id,
            estimate_id,
            version_number,
            snapshot_data,
            change_reason,
            previous_version_id,
            created_by,
            is_current
        ) VALUES (
            NEW.tenant_id,
            NEW.id,
            next_version_number,
            jsonb_build_object(
                'estimate_number', NEW.estimate_number,
                'status', NEW.status,
                'selling_price', NEW.selling_price,
                'material_cost', NEW.material_cost,
                'labor_cost', NEW.labor_cost,
                'overhead_amount', NEW.overhead_amount,
                'overhead_percent', NEW.overhead_percent,
                'target_margin_percent', NEW.target_margin_percent,
                'actual_margin_percent', NEW.actual_margin_percent,
                'actual_profit', NEW.actual_profit,
                'line_items', NEW.line_items,
                'parameters', NEW.parameters,
                'valid_until', NEW.valid_until,
                'sent_at', NEW.sent_at,
                'approved_at', NEW.approved_at
            ),
            CASE 
                WHEN OLD.status != NEW.status THEN 'Status changed from ' || OLD.status || ' to ' || NEW.status
                WHEN OLD.selling_price != NEW.selling_price THEN 'Price changed from $' || OLD.selling_price || ' to $' || NEW.selling_price
                ELSE 'Estimate updated'
            END,
            previous_version_id,
            auth.uid(),
            true
        );
        
    END IF;
    
    -- Create initial version for new estimates
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.estimate_versions (
            tenant_id,
            estimate_id,
            version_number,
            snapshot_data,
            change_reason,
            created_by,
            is_current
        ) VALUES (
            NEW.tenant_id,
            NEW.id,
            1,
            jsonb_build_object(
                'estimate_number', NEW.estimate_number,
                'status', NEW.status,
                'selling_price', NEW.selling_price,
                'material_cost', NEW.material_cost,
                'labor_cost', NEW.labor_cost,
                'overhead_amount', NEW.overhead_amount,
                'overhead_percent', NEW.overhead_percent,
                'target_margin_percent', NEW.target_margin_percent,
                'actual_margin_percent', NEW.actual_margin_percent,
                'actual_profit', NEW.actual_profit,
                'line_items', NEW.line_items,
                'parameters', NEW.parameters,
                'valid_until', NEW.valid_until
            ),
            'Initial version created',
            auth.uid(),
            true
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;