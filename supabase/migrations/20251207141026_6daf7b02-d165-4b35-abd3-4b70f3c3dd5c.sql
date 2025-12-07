-- Create trusted_devices table for device fingerprinting
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  ip_address TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  trusted_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_fingerprint)
);

-- Create index for faster lookups
CREATE INDEX idx_trusted_devices_user_id ON public.trusted_devices(user_id);
CREATE INDEX idx_trusted_devices_fingerprint ON public.trusted_devices(device_fingerprint);

-- Enable RLS
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

-- Users can only see their own trusted devices
CREATE POLICY "Users can view their own trusted devices"
ON public.trusted_devices
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own trusted devices
CREATE POLICY "Users can add their own trusted devices"
ON public.trusted_devices
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own trusted devices
CREATE POLICY "Users can update their own trusted devices"
ON public.trusted_devices
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own trusted devices
CREATE POLICY "Users can delete their own trusted devices"
ON public.trusted_devices
FOR DELETE
USING (auth.uid() = user_id);