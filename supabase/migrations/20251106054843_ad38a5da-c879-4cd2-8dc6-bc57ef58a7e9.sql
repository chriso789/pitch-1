-- Create approval rules table
CREATE TABLE IF NOT EXISTS public.purchase_order_approval_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rule_name TEXT NOT NULL,
  min_amount NUMERIC NOT NULL DEFAULT 0,
  max_amount NUMERIC,
  required_approvers JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of role names or user IDs
  approval_type TEXT NOT NULL DEFAULT 'sequential', -- 'sequential' or 'parallel' or 'any'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  CONSTRAINT valid_amount_range CHECK (min_amount >= 0 AND (max_amount IS NULL OR max_amount > min_amount))
);

-- Create purchase order approvals table
CREATE TABLE IF NOT EXISTS public.purchase_order_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.purchase_order_approval_rules(id),
  required_approver_id UUID,
  required_approver_role TEXT,
  approver_id UUID,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  approval_level INTEGER NOT NULL DEFAULT 1,
  comments TEXT,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create approval history table for audit trail
CREATE TABLE IF NOT EXISTS public.purchase_order_approval_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  approval_id UUID REFERENCES public.purchase_order_approvals(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'requested', 'approved', 'rejected', 'cancelled'
  actor_id UUID,
  comments TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX idx_po_approval_rules_tenant ON public.purchase_order_approval_rules(tenant_id);
CREATE INDEX idx_po_approval_rules_active ON public.purchase_order_approval_rules(tenant_id, is_active);
CREATE INDEX idx_po_approvals_tenant ON public.purchase_order_approvals(tenant_id);
CREATE INDEX idx_po_approvals_po ON public.purchase_order_approvals(po_id);
CREATE INDEX idx_po_approvals_status ON public.purchase_order_approvals(status);
CREATE INDEX idx_po_approvals_approver ON public.purchase_order_approvals(required_approver_id);
CREATE INDEX idx_po_approval_history_po ON public.purchase_order_approval_history(po_id);

-- Enable RLS
ALTER TABLE public.purchase_order_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_approval_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for approval rules
CREATE POLICY "Users can view approval rules in their tenant"
  ON public.purchase_order_approval_rules
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage approval rules"
  ON public.purchase_order_approval_rules
  FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies for approvals
CREATE POLICY "Users can view approvals in their tenant"
  ON public.purchase_order_approvals
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage approvals"
  ON public.purchase_order_approvals
  FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies for approval history
CREATE POLICY "Users can view approval history in their tenant"
  ON public.purchase_order_approval_history
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert approval history"
  ON public.purchase_order_approval_history
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Insert default approval rules
INSERT INTO public.purchase_order_approval_rules (tenant_id, rule_name, min_amount, max_amount, required_approvers, approval_type, created_by)
VALUES 
  ('00000000-0000-0000-0000-000000000000', 'Small Orders', 0, 5000, '["office_admin"]'::jsonb, 'any', NULL),
  ('00000000-0000-0000-0000-000000000000', 'Medium Orders', 5000, 25000, '["regional_manager"]'::jsonb, 'any', NULL),
  ('00000000-0000-0000-0000-000000000000', 'Large Orders', 25000, NULL, '["corporate", "master"]'::jsonb, 'any', NULL)
ON CONFLICT DO NOTHING;

-- Function to automatically determine approval requirements
CREATE OR REPLACE FUNCTION public.determine_approval_requirements(
  p_tenant_id UUID,
  p_order_amount NUMERIC
)
RETURNS TABLE (
  rule_id UUID,
  rule_name TEXT,
  required_approvers JSONB,
  approval_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.rule_name,
    r.required_approvers,
    r.approval_type
  FROM public.purchase_order_approval_rules r
  WHERE r.tenant_id = p_tenant_id
    AND r.is_active = true
    AND p_order_amount >= r.min_amount
    AND (r.max_amount IS NULL OR p_order_amount < r.max_amount)
  ORDER BY r.min_amount ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if order is fully approved
CREATE OR REPLACE FUNCTION public.is_order_fully_approved(p_po_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_pending_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.purchase_order_approvals
  WHERE po_id = p_po_id
    AND status = 'pending';
    
  RETURN v_pending_count = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update purchase order status when all approvals are completed
CREATE OR REPLACE FUNCTION public.update_po_status_on_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_all_approved BOOLEAN;
  v_any_rejected BOOLEAN;
BEGIN
  -- Check if any approval is rejected
  SELECT EXISTS(
    SELECT 1 FROM public.purchase_order_approvals
    WHERE po_id = NEW.po_id AND status = 'rejected'
  ) INTO v_any_rejected;
  
  IF v_any_rejected THEN
    UPDATE public.purchase_orders
    SET status = 'approval_rejected'
    WHERE id = NEW.po_id;
    RETURN NEW;
  END IF;
  
  -- Check if all approvals are approved
  SELECT NOT EXISTS(
    SELECT 1 FROM public.purchase_order_approvals
    WHERE po_id = NEW.po_id AND status = 'pending'
  ) INTO v_all_approved;
  
  IF v_all_approved THEN
    UPDATE public.purchase_orders
    SET status = 'approved'
    WHERE id = NEW.po_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_po_status_on_approval
  AFTER UPDATE OF status ON public.purchase_order_approvals
  FOR EACH ROW
  WHEN (NEW.status IN ('approved', 'rejected'))
  EXECUTE FUNCTION public.update_po_status_on_approval();