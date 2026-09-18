
CREATE TABLE public.commission_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  pipeline_entry_id UUID REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  project_id UUID,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'check',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','quickbooks')),
  reference TEXT,
  qbo_entity_type TEXT,
  qbo_entity_id TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_payments TO authenticated;
GRANT ALL ON public.commission_payments TO service_role;

ALTER TABLE public.commission_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view commission payments"
ON public.commission_payments FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Managers can insert commission payments"
ON public.commission_payments FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('master','owner','corporate','office_admin','regional_manager','sales_manager')
  )
);

CREATE POLICY "Managers can update commission payments"
ON public.commission_payments FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('master','owner','corporate','office_admin','regional_manager','sales_manager')
  )
)
WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Managers can delete commission payments"
ON public.commission_payments FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('master','owner','corporate','office_admin','regional_manager','sales_manager')
  )
);

CREATE INDEX idx_commission_payments_tenant_user ON public.commission_payments(tenant_id, user_id);
CREATE INDEX idx_commission_payments_entry ON public.commission_payments(pipeline_entry_id);
CREATE UNIQUE INDEX idx_commission_payments_qbo_unique
  ON public.commission_payments(tenant_id, qbo_entity_type, qbo_entity_id)
  WHERE qbo_entity_id IS NOT NULL;

CREATE TRIGGER update_commission_payments_updated_at
BEFORE UPDATE ON public.commission_payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
