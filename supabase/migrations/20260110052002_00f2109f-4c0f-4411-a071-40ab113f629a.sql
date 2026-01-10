-- ============================================
-- 4-Feature Buildout Migration
-- 1. Brands (White-Label)
-- 2. AI Call Fields
-- 3. Unmatched Inbox View + Index
-- 4. Call Transcripts Enhancement
-- ============================================

-- =========================
-- A) BRANDS TABLE (WHITE-LABEL)
-- =========================
CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  logo_url TEXT,
  primary_color TEXT,
  website TEXT,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  email_from_name TEXT,
  email_from_address TEXT,
  ai_persona_prompt TEXT,
  ai_safety_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

-- Enable RLS
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- RLS policies for brands using existing get_user_tenant_id() pattern
CREATE POLICY "brands_tenant_read" ON public.brands
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "brands_tenant_insert" ON public.brands
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "brands_tenant_update" ON public.brands
  FOR UPDATE USING (tenant_id = get_user_tenant_id());

CREATE POLICY "brands_tenant_delete" ON public.brands
  FOR DELETE USING (tenant_id = get_user_tenant_id());

-- =========================
-- B) AI CALL FIELDS ON calls TABLE
-- =========================
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_outcome TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_insights JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_type TEXT;

-- Add brand_id to related tables
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE public.sms_messages ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;

-- =========================
-- C) UNMATCHED INBOX VIEW
-- =========================
CREATE OR REPLACE VIEW public.v_unmatched_inbox AS
SELECT
  ui.id,
  ui.tenant_id,
  ui.from_e164,
  ui.to_e164,
  ui.channel,
  ui.body,
  ui.state,
  ui.event_type,
  ui.received_at,
  ui.notes,
  ui.contact_id,
  ui.conversation_id,
  ui.location_id,
  ui.media,
  ui.raw_payload,
  l.name as location_name,
  l.telnyx_phone_number as location_did
FROM public.unmatched_inbound ui
LEFT JOIN public.locations l ON l.id = ui.location_id;

-- Add index for faster unmatched inbox queries
CREATE INDEX IF NOT EXISTS idx_unmatched_tenant_from_time
  ON public.unmatched_inbound(tenant_id, from_e164, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_unmatched_state
  ON public.unmatched_inbound(tenant_id, state, received_at DESC);

-- =========================
-- D) CALL TRANSCRIPTS ENHANCEMENT
-- =========================
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS telnyx_transcription_id TEXT;
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'saved';
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}'::jsonb;

-- Add unique constraint for idempotent upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_call_transcripts_telnyx_id'
  ) THEN
    CREATE UNIQUE INDEX idx_call_transcripts_telnyx_id 
      ON public.call_transcripts(tenant_id, telnyx_transcription_id) 
      WHERE telnyx_transcription_id IS NOT NULL;
  END IF;
END $$;

-- =========================
-- E) CALL RECORDINGS ENHANCEMENT
-- =========================
ALTER TABLE public.call_recordings ADD COLUMN IF NOT EXISTS telnyx_recording_id TEXT;
ALTER TABLE public.call_recordings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'saved';
ALTER TABLE public.call_recordings ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}'::jsonb;

-- Add unique constraint for idempotent upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_call_recordings_telnyx_id'
  ) THEN
    CREATE UNIQUE INDEX idx_call_recordings_telnyx_id 
      ON public.call_recordings(tenant_id, telnyx_recording_id) 
      WHERE telnyx_recording_id IS NOT NULL;
  END IF;
END $$;

-- =========================
-- F) BRANDS TRIGGER FOR UPDATED_AT
-- =========================
CREATE OR REPLACE FUNCTION public.update_brands_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_brands_updated_at ON public.brands;
CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_brands_updated_at();