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
DROP POLICY IF EXISTS "Masters can access all tenants" ON public.tenants;
CREATE POLICY "Masters can access all tenants" ON public.tenants
FOR ALL USING (public.has_role('master'));

DROP POLICY IF EXISTS "Users can view their own tenant" ON public.tenants;
CREATE POLICY "Users can view their own tenant" ON public.tenants
FOR SELECT USING (id = public.get_user_tenant_id());

-- Tenant settings policies
DROP POLICY IF EXISTS "Masters can manage all tenant settings" ON public.tenant_settings;
CREATE POLICY "Masters can manage all tenant settings" ON public.tenant_settings
FOR ALL USING (public.has_role('master'));

DROP POLICY IF EXISTS "Admins can view their tenant settings" ON public.tenant_settings;
CREATE POLICY "Admins can view their tenant settings" ON public.tenant_settings
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can update their tenant settings" ON public.tenant_settings;
CREATE POLICY "Admins can update their tenant settings" ON public.tenant_settings
FOR UPDATE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('master')));

-- Profiles policies
DROP POLICY IF EXISTS "Users can view profiles in their tenant" ON public.profiles;
CREATE POLICY "Users can view profiles in their tenant" ON public.profiles
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
FOR UPDATE USING (id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage profiles in their tenant" ON public.profiles;
CREATE POLICY "Admins can manage profiles in their tenant" ON public.profiles
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('master')));

DROP POLICY IF EXISTS "Masters can access all profiles" ON public.profiles;
CREATE POLICY "Masters can access all profiles" ON public.profiles
FOR ALL USING (public.has_role('master'));

-- Contacts policies (tenant-scoped)
DROP POLICY IF EXISTS "Users can view contacts in their tenant" ON public.contacts;
CREATE POLICY "Users can view contacts in their tenant" ON public.contacts
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create contacts in their tenant" ON public.contacts;
CREATE POLICY "Users can create contacts in their tenant" ON public.contacts
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update contacts in their tenant" ON public.contacts;
CREATE POLICY "Users can update contacts in their tenant" ON public.contacts
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete contacts in their tenant" ON public.contacts;
CREATE POLICY "Admins can delete contacts in their tenant" ON public.contacts
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Pipeline entries policies
DROP POLICY IF EXISTS "Users can view pipeline entries in their tenant" ON public.pipeline_entries;
CREATE POLICY "Users can view pipeline entries in their tenant" ON public.pipeline_entries
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create pipeline entries in their tenant" ON public.pipeline_entries;
CREATE POLICY "Users can create pipeline entries in their tenant" ON public.pipeline_entries
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update pipeline entries in their tenant" ON public.pipeline_entries;
CREATE POLICY "Users can update pipeline entries in their tenant" ON public.pipeline_entries
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete pipeline entries in their tenant" ON public.pipeline_entries;
CREATE POLICY "Admins can delete pipeline entries in their tenant" ON public.pipeline_entries
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Projects policies
DROP POLICY IF EXISTS "Users can view projects in their tenant" ON public.projects;
CREATE POLICY "Users can view projects in their tenant" ON public.projects
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create projects in their tenant" ON public.projects;
CREATE POLICY "Users can create projects in their tenant" ON public.projects
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update projects in their tenant" ON public.projects;
CREATE POLICY "Users can update projects in their tenant" ON public.projects
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete projects in their tenant" ON public.projects;
CREATE POLICY "Admins can delete projects in their tenant" ON public.projects
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Supplier pricebooks policies
DROP POLICY IF EXISTS "Users can view pricebooks in their tenant" ON public.supplier_pricebooks;
CREATE POLICY "Users can view pricebooks in their tenant" ON public.supplier_pricebooks
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can manage pricebooks in their tenant" ON public.supplier_pricebooks;
CREATE POLICY "Admins can manage pricebooks in their tenant" ON public.supplier_pricebooks
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Estimate templates policies
DROP POLICY IF EXISTS "Users can view templates in their tenant" ON public.estimate_templates;
CREATE POLICY "Users can view templates in their tenant" ON public.estimate_templates
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can manage templates in their tenant" ON public.estimate_templates;
CREATE POLICY "Admins can manage templates in their tenant" ON public.estimate_templates
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Estimates policies
DROP POLICY IF EXISTS "Users can view estimates in their tenant" ON public.estimates;
CREATE POLICY "Users can view estimates in their tenant" ON public.estimates
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create estimates in their tenant" ON public.estimates;
CREATE POLICY "Users can create estimates in their tenant" ON public.estimates
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update estimates in their tenant" ON public.estimates;
CREATE POLICY "Users can update estimates in their tenant" ON public.estimates
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete estimates in their tenant" ON public.estimates;
CREATE POLICY "Admins can delete estimates in their tenant" ON public.estimates
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Project budget snapshots policies (read-only after creation)
DROP POLICY IF EXISTS "Users can view budget snapshots in their tenant" ON public.project_budget_snapshots;
CREATE POLICY "Users can view budget snapshots in their tenant" ON public.project_budget_snapshots
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create budget snapshots in their tenant" ON public.project_budget_snapshots;
CREATE POLICY "Users can create budget snapshots in their tenant" ON public.project_budget_snapshots
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Project costs policies
DROP POLICY IF EXISTS "Users can view project costs in their tenant" ON public.project_costs;
CREATE POLICY "Users can view project costs in their tenant" ON public.project_costs
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create project costs in their tenant" ON public.project_costs;
CREATE POLICY "Users can create project costs in their tenant" ON public.project_costs
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update project costs in their tenant" ON public.project_costs;
CREATE POLICY "Users can update project costs in their tenant" ON public.project_costs
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete project costs in their tenant" ON public.project_costs;
CREATE POLICY "Admins can delete project costs in their tenant" ON public.project_costs
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Rep overhead rules policies
DROP POLICY IF EXISTS "Users can view overhead rules in their tenant" ON public.rep_overhead_rules;
CREATE POLICY "Users can view overhead rules in their tenant" ON public.rep_overhead_rules
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can manage overhead rules in their tenant" ON public.rep_overhead_rules;
CREATE POLICY "Admins can manage overhead rules in their tenant" ON public.rep_overhead_rules
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Commission plans policies
DROP POLICY IF EXISTS "Users can view commission plans in their tenant" ON public.commission_plans;
CREATE POLICY "Users can view commission plans in their tenant" ON public.commission_plans
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can manage commission plans in their tenant" ON public.commission_plans;
CREATE POLICY "Admins can manage commission plans in their tenant" ON public.commission_plans
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- User commission plan assignments policies
DROP POLICY IF EXISTS "Users can view commission assignments in their tenant" ON public.user_commission_plans;
CREATE POLICY "Users can view commission assignments in their tenant" ON public.user_commission_plans
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can view their own commission assignment" ON public.user_commission_plans;
CREATE POLICY "Users can view their own commission assignment" ON public.user_commission_plans
FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage commission assignments in their tenant" ON public.user_commission_plans;
CREATE POLICY "Admins can manage commission assignments in their tenant" ON public.user_commission_plans
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Outbox events policies (system internal)
DROP POLICY IF EXISTS "System can manage outbox events in tenant" ON public.outbox_events;
CREATE POLICY "System can manage outbox events in tenant" ON public.outbox_events
FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Idempotency keys policies (system internal)
DROP POLICY IF EXISTS "System can manage idempotency keys in tenant" ON public.idempotency_keys;
CREATE POLICY "System can manage idempotency keys in tenant" ON public.idempotency_keys
FOR ALL USING (tenant_id = public.get_user_tenant_id());

-- Payments policies
DROP POLICY IF EXISTS "Users can view payments in their tenant" ON public.payments;
CREATE POLICY "Users can view payments in their tenant" ON public.payments
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create payments in their tenant" ON public.payments;
CREATE POLICY "Users can create payments in their tenant" ON public.payments
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can manage payments in their tenant" ON public.payments;
CREATE POLICY "Admins can manage payments in their tenant" ON public.payments
FOR ALL USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Portal access grants policies
DROP POLICY IF EXISTS "Users can view portal grants in their tenant" ON public.portal_access_grants;
CREATE POLICY "Users can view portal grants in their tenant" ON public.portal_access_grants
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create portal grants in their tenant" ON public.portal_access_grants;
CREATE POLICY "Users can create portal grants in their tenant" ON public.portal_access_grants
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update portal grants in their tenant" ON public.portal_access_grants;
CREATE POLICY "Users can update portal grants in their tenant" ON public.portal_access_grants
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete portal grants in their tenant" ON public.portal_access_grants;
CREATE POLICY "Admins can delete portal grants in their tenant" ON public.portal_access_grants
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Documents policies
DROP POLICY IF EXISTS "Users can view documents in their tenant" ON public.documents;
CREATE POLICY "Users can view documents in their tenant" ON public.documents
FOR SELECT USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create documents in their tenant" ON public.documents;
CREATE POLICY "Users can create documents in their tenant" ON public.documents
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update documents in their tenant" ON public.documents;
CREATE POLICY "Users can update documents in their tenant" ON public.documents
FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete documents in their tenant" ON public.documents;
CREATE POLICY "Admins can delete documents in their tenant" ON public.documents
FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('manager') OR public.has_role('master')));

-- Audit log policies (admins and masters only)
DROP POLICY IF EXISTS "Admins can view audit log in their tenant" ON public.audit_log;
CREATE POLICY "Admins can view audit log in their tenant" ON public.audit_log
FOR SELECT USING (tenant_id = public.get_user_tenant_id() AND (public.has_role('admin') OR public.has_role('master')));

DROP POLICY IF EXISTS "System can insert audit entries" ON public.audit_log;
CREATE POLICY "System can insert audit entries" ON public.audit_log
FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());