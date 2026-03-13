
-- Mobile devices table for push notification registration
CREATE TABLE public.mobile_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL,
  push_token TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

-- RLS: users can only manage their own devices
ALTER TABLE public.mobile_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own devices"
  ON public.mobile_devices
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own devices"
  ON public.mobile_devices
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own devices"
  ON public.mobile_devices
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own devices"
  ON public.mobile_devices
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Service role bypass for edge functions
CREATE POLICY "Service role full access"
  ON public.mobile_devices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
