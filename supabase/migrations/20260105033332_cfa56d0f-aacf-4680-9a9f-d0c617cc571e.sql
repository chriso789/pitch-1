-- Add password_set_at column to track when users create their password
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.password_set_at IS 'Timestamp when user first set their password during account setup';