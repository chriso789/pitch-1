-- Create table for storing Google Calendar OAuth connections
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  calendar_id TEXT,
  calendar_name TEXT,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, tenant_id)
);

-- Enable RLS
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own Google Calendar connections"
ON public.google_calendar_connections
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Google Calendar connections"
ON public.google_calendar_connections
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Google Calendar connections"
ON public.google_calendar_connections
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Google Calendar connections"
ON public.google_calendar_connections
FOR DELETE
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_google_calendar_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_google_calendar_connections_updated_at
BEFORE UPDATE ON public.google_calendar_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_google_calendar_connections_updated_at();

-- Create index for faster lookups
CREATE INDEX idx_google_calendar_connections_user_tenant 
ON public.google_calendar_connections(user_id, tenant_id);

CREATE INDEX idx_google_calendar_connections_active 
ON public.google_calendar_connections(is_active) 
WHERE is_active = true;