-- Create tables for call forwarding and answering service
CREATE TABLE IF NOT EXISTS public.call_forwarding_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.call_forwarding_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  from_number TEXT NOT NULL,
  original_number TEXT NOT NULL,
  forwarded_number TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.answering_service_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  custom_greeting TEXT,
  voice_settings JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.answered_calls_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  caller_number TEXT NOT NULL,
  answered_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status TEXT NOT NULL,
  duration INTEGER DEFAULT 0,
  transcription TEXT,
  disposition TEXT,
  escalated_to_human BOOLEAN DEFAULT false
);

-- Enable RLS
ALTER TABLE public.call_forwarding_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_forwarding_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answering_service_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answered_calls_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage forwarding rules in their tenant" ON public.call_forwarding_rules
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view forwarding logs in their tenant" ON public.call_forwarding_log
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage answering service config" ON public.answering_service_config
  FOR ALL USING (tenant_id = get_user_tenant_id() AND has_role('admin'));

CREATE POLICY "Users can view answered calls in their tenant" ON public.answered_calls_log
  FOR SELECT USING (tenant_id = get_user_tenant_id());