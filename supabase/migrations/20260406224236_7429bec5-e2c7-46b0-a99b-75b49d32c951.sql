-- Add Zelle configuration to tenant_settings
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS zelle_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zelle_email TEXT,
  ADD COLUMN IF NOT EXISTS zelle_phone TEXT,
  ADD COLUMN IF NOT EXISTS zelle_display_name TEXT,
  ADD COLUMN IF NOT EXISTS zelle_instructions TEXT;

-- Add Zelle columns to payment_links
ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS zelle_confirmation_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS shareable_token TEXT;

-- Unique index on shareable_token (allow nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_shareable_token 
  ON public.payment_links(shareable_token) WHERE shareable_token IS NOT NULL;

-- Public read access for payment pages (anon users viewing via token)
CREATE POLICY "Public can view payment links by token"
  ON public.payment_links
  FOR SELECT
  TO anon
  USING (shareable_token IS NOT NULL);