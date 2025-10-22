-- Create call_dispositions table for storing call outcomes
CREATE TABLE IF NOT EXISTS public.call_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  call_id UUID REFERENCES public.call_logs(id) ON DELETE CASCADE,
  call_sid TEXT,
  disposition TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.call_dispositions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their tenant's call dispositions"
  ON public.call_dispositions FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create call dispositions for their tenant"
  ON public.call_dispositions FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update their tenant's call dispositions"
  ON public.call_dispositions FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Create index for faster lookups
CREATE INDEX idx_call_dispositions_tenant ON public.call_dispositions(tenant_id);
CREATE INDEX idx_call_dispositions_call_id ON public.call_dispositions(call_id);
CREATE INDEX idx_call_dispositions_call_sid ON public.call_dispositions(call_sid);

-- Create smartwords_rules table for transcript analysis rules
CREATE TABLE IF NOT EXISTS public.smartwords_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('tag', 'task', 'sms', 'email', 'note', 'disposition')),
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.smartwords_rules ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their tenant's smartwords rules"
  ON public.smartwords_rules FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their tenant's smartwords rules"
  ON public.smartwords_rules FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Create index
CREATE INDEX idx_smartwords_rules_tenant ON public.smartwords_rules(tenant_id, is_active);

-- Create trigger for updated_at
CREATE TRIGGER update_smartwords_rules_updated_at
  BEFORE UPDATE ON public.smartwords_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();