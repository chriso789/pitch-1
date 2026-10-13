CREATE TABLE public.marketing_cost_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 channel text NOT NULL CHECK (channel IN ('facebook','instagram','google','yelp','other')),
 campaign text NOT NULL DEFAULT '', placement text NOT NULL DEFAULT '',
 expense_date date NOT NULL,
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
 entry_type text NOT NULL DEFAULT 'expense' CHECK (entry_type IN ('expense','credit')),
 reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.marketing_cost_entries TO authenticated;
GRANT ALL ON public.marketing_cost_entries TO service_role;
ALTER TABLE public.marketing_cost_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketing_cost_member_read ON public.marketing_cost_entries FOR SELECT TO authenticated USING (
 tenant_id = public.get_user_tenant_id() AND NOT public.is_login_blocked()
 AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=tenant_id AND t.is_active=true)
 AND (public.has_role(auth.uid(),'master'::public.app_role)
 OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=marketing_cost_entries.tenant_id)
 OR EXISTS (SELECT 1 FROM public.user_company_access a WHERE a.user_id=auth.uid() AND a.tenant_id=marketing_cost_entries.tenant_id AND a.is_active=true))
);
CREATE POLICY marketing_cost_member_insert ON public.marketing_cost_entries FOR INSERT TO authenticated WITH CHECK (
 created_by=auth.uid() AND tenant_id = public.get_user_tenant_id() AND NOT public.is_login_blocked()
 AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=tenant_id AND t.is_active=true)
 AND (public.has_role(auth.uid(),'master'::public.app_role)
 OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=marketing_cost_entries.tenant_id)
 OR EXISTS (SELECT 1 FROM public.user_company_access a WHERE a.user_id=auth.uid() AND a.tenant_id=marketing_cost_entries.tenant_id AND a.is_active=true))
);
CREATE INDEX marketing_cost_entries_tenant_date ON public.marketing_cost_entries(tenant_id, expense_date DESC);
CREATE FUNCTION public.marketing_cost_entries_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Marketing cost history is immutable; record a credit or a new expense.'; END;
$$;
CREATE TRIGGER marketing_cost_entries_immutable BEFORE UPDATE OR DELETE ON public.marketing_cost_entries FOR EACH ROW EXECUTE FUNCTION public.marketing_cost_entries_immutable();