-- Fixed RLS Policies for PITCH Multi-Tenant System
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

-- Create security definer function to check if user has any of multiple roles (fixed)
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

CREATE POLICY "Admins can view their tenant settings" ON public.tenant_settings
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can update their tenant settings" ON public.tenant_settings
FOR UPDATE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('master')));

-- Profiles policies
CREATE POLICY "Users can view profiles in their tenant" ON public.profiles
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update their own profile" ON public.profiles
FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Admins can manage profiles in their tenant" ON public.profiles
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('master')));

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
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Pipeline entries policies
CREATE POLICY "Users can view pipeline entries in their tenant" ON public.pipeline_entries
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create pipeline entries in their tenant" ON public.pipeline_entries
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update pipeline entries in their tenant" ON public.pipeline_entries
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete pipeline entries in their tenant" ON public.pipeline_entries
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Projects policies
CREATE POLICY "Users can view projects in their tenant" ON public.projects
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create projects in their tenant" ON public.projects
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update projects in their tenant" ON public.projects
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete projects in their tenant" ON public.projects
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Supplier pricebooks policies
CREATE POLICY "Users can view pricebooks in their tenant" ON public.supplier_pricebooks
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage pricebooks in their tenant" ON public.supplier_pricebooks
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Estimate templates policies
CREATE POLICY "Users can view templates in their tenant" ON public.estimate_templates
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage templates in their tenant" ON public.estimate_templates
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Estimates policies
CREATE POLICY "Users can view estimates in their tenant" ON public.estimates
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create estimates in their tenant" ON public.estimates
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update estimates in their tenant" ON public.estimates
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete estimates in their tenant" ON public.estimates
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

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
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Rep overhead rules policies
CREATE POLICY "Users can view overhead rules in their tenant" ON public.rep_overhead_rules
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage overhead rules in their tenant" ON public.rep_overhead_rules
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Commission plans policies
CREATE POLICY "Users can view commission plans in their tenant" ON public.commission_plans
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage commission plans in their tenant" ON public.commission_plans
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- User commission plan assignments policies
CREATE POLICY "Users can view commission assignments in their tenant" ON public.user_commission_plans
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can view their own commission assignment" ON public.user_commission_plans
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage commission assignments in their tenant" ON public.user_commission_plans
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

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
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Portal access grants policies
CREATE POLICY "Users can view portal grants in their tenant" ON public.portal_access_grants
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create portal grants in their tenant" ON public.portal_access_grants
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update portal grants in their tenant" ON public.portal_access_grants
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete portal grants in their tenant" ON public.portal_access_grants
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Documents policies
CREATE POLICY "Users can view documents in their tenant" ON public.documents
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create documents in their tenant" ON public.documents
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update documents in their tenant" ON public.documents
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can delete documents in their tenant" ON public.documents
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Audit log policies (admins and masters only)
CREATE POLICY "Admins can view audit log in their tenant" ON public.audit_log
FOR SELECT USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('master')));

CREATE POLICY "System can insert audit entries" ON public.audit_log
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());