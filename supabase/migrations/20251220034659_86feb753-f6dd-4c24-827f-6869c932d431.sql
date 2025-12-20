-- ============================================================================
-- Communication System Schema Updates
-- Adds call_activity_log table, location_id to SMS tables, and indexes
-- ============================================================================

-- 1. Create call_activity_log table for call forwarding and routing logs
CREATE TABLE IF NOT EXISTS public.call_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  activity TEXT NOT NULL,
  call_control_id TEXT,
  status TEXT DEFAULT 'initiated',
  duration_seconds INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on call_activity_log
ALTER TABLE public.call_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS policy for call_activity_log
CREATE POLICY "Users can view their tenant's call activity"
  ON public.call_activity_log
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
      UNION
      SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
    )
  );

-- 2. Add location_id to sms_messages if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'sms_messages' 
    AND column_name = 'location_id'
  ) THEN
    ALTER TABLE public.sms_messages ADD COLUMN location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Add location_id to sms_threads if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'sms_threads' 
    AND column_name = 'location_id'
  ) THEN
    ALTER TABLE public.sms_threads ADD COLUMN location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Create index for phone number lookups on locations
CREATE INDEX IF NOT EXISTS idx_locations_telnyx_phone 
  ON public.locations(telnyx_phone_number) 
  WHERE telnyx_phone_number IS NOT NULL;

-- 5. Create index for call activity lookups
CREATE INDEX IF NOT EXISTS idx_call_activity_log_tenant 
  ON public.call_activity_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_activity_log_location 
  ON public.call_activity_log(location_id) 
  WHERE location_id IS NOT NULL;

-- 6. Add trigger for updated_at on call_activity_log
CREATE OR REPLACE FUNCTION public.update_call_activity_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_call_activity_log_updated_at ON public.call_activity_log;
CREATE TRIGGER trigger_call_activity_log_updated_at
  BEFORE UPDATE ON public.call_activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.update_call_activity_log_updated_at();