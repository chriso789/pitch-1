-- RLS Policies for PITCH Multi-Tenant System
-- Create security definer function to get current user's tenant_id
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Create security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(required_role app_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = required_role
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Create security definer function to check if user has any of multiple roles
CREATE OR REPLACE FUNCTION public.has_any_role(required_roles app_role[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = ANY(required_roles)
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Tenants policies (Masters can access all, others see only their tenant)
CREATE POLICY "Masters can access all tenants" ON public.tenants
FOR ALL USING (public.has_role('master'));

CREATE POLICY "Users can view their own tenant" ON public.tenants
FOR SELECT USING (id = public.get_user_tenant_id());

-- Tenant settings policies
CREATE POLICY "Masters can manage all tenant settings" ON public.tenant_settings
FOR ALL USING (public.has_role('master'));

CREATE POLICY "Admins can view and update their tenant settings" ON public.tenant_settings
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can update their tenant settings" ON public.tenant_settings
FOR UPDATE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'master']));

-- Profiles policies
CREATE POLICY "Users can view profiles in their tenant" ON public.profiles
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update their own profile" ON public.profiles
FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Admins can manage profiles in their tenant" ON public.profiles
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'master']));

CREATE POLICY "Masters can access all profiles" ON public.profiles
FOR ALL USING (public.has_role('master'));

-- Contacts policies (tenant-scoped)
CREATE POLICY "Users can view contacts in their tenant" ON public.contacts
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create contacts in their tenant" ON public.contacts
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update contacts in their tenant" ON public.contacts
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete contacts in their tenant" ON public.contacts
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Pipeline entries policies
CREATE POLICY "Users can view pipeline entries in their tenant" ON public.pipeline_entries
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create pipeline entries in their tenant" ON public.pipeline_entries
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update pipeline entries in their tenant" ON public.pipeline_entries
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete pipeline entries in their tenant" ON public.pipeline_entries
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Projects policies
CREATE POLICY "Users can view projects in their tenant" ON public.projects
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create projects in their tenant" ON public.projects
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update projects in their tenant" ON public.projects
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete projects in their tenant" ON public.projects
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Supplier pricebooks policies
CREATE POLICY "Users can view pricebooks in their tenant" ON public.supplier_pricebooks
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage pricebooks in their tenant" ON public.supplier_pricebooks
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Estimate templates policies
CREATE POLICY "Users can view templates in their tenant" ON public.estimate_templates
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage templates in their tenant" ON public.estimate_templates
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Estimates policies
CREATE POLICY "Users can view estimates in their tenant" ON public.estimates
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create estimates in their tenant" ON public.estimates
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update estimates in their tenant" ON public.estimates
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete estimates in their tenant" ON public.estimates
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Project budget snapshots policies (read-only after creation)
CREATE POLICY "Users can view budget snapshots in their tenant" ON public.project_budget_snapshots
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create budget snapshots in their tenant" ON public.project_budget_snapshots
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Project costs policies
CREATE POLICY "Users can view project costs in their tenant" ON public.project_costs
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create project costs in their tenant" ON public.project_costs
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update project costs in their tenant" ON public.project_costs
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete project costs in their tenant" ON public.project_costs
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Rep overhead rules policies
CREATE POLICY "Users can view overhead rules in their tenant" ON public.rep_overhead_rules
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage overhead rules in their tenant" ON public.rep_overhead_rules
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Commission plans policies
CREATE POLICY "Users can view commission plans in their tenant" ON public.commission_plans
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage commission plans in their tenant" ON public.commission_plans
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- User commission plan assignments policies
CREATE POLICY "Users can view commission assignments in their tenant" ON public.user_commission_plans
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can view their own commission assignment" ON public.user_commission_plans
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage commission assignments in their tenant" ON public.user_commission_plans
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Outbox events policies (system internal)
CREATE POLICY "System can manage outbox events in tenant" ON public.outbox_events
FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Idempotency keys policies (system internal)
CREATE POLICY "System can manage idempotency keys in tenant" ON public.idempotency_keys
FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Payments policies
CREATE POLICY "Users can view payments in their tenant" ON public.payments
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create payments in their tenant" ON public.payments
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage payments in their tenant" ON public.payments
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Portal access grants policies
CREATE POLICY "Users can view portal grants in their tenant" ON public.portal_access_grants
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create portal grants in their tenant" ON public.portal_access_grants
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update portal grants in their tenant" ON public.portal_access_grants
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete portal grants in their tenant" ON public.portal_access_grants
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Documents policies
CREATE POLICY "Users can view documents in their tenant" ON public.documents
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create documents in their tenant" ON public.documents
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update documents in their tenant" ON public.documents
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete documents in their tenant" ON public.documents
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'manager', 'master']));

-- Audit log policies (admins and masters only)
CREATE POLICY "Admins can view audit log in their tenant" ON public.audit_log
FOR SELECT USING (tenant_id = public.get_user_tenant_id() AND public.has_any_role(ARRAY['admin', 'master']));

CREATE POLICY "System can insert audit entries" ON public.audit_log
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Create functions for profit validation and audit triggers
CREATE OR REPLACE FUNCTION public.validate_estimate_min_profit()
RETURNS TRIGGER AS $$
DECLARE
    min_margin DECIMAL(5,2);
    min_amount DECIMAL(10,2);
    tenant_settings RECORD;
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