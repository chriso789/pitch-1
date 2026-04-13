-- Add verification workflow columns to roof_training_sessions
ALTER TABLE public.roof_training_sessions
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS verification_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_completed_at timestamptz;

-- Index for efficient dashboard queries
CREATE INDEX IF NOT EXISTS idx_rts_verification_status
  ON public.roof_training_sessions (tenant_id, ground_truth_source, verification_status);

-- Backfill tenant_id on roof_vendor_reports from linked training sessions
UPDATE public.roof_vendor_reports rvr
SET tenant_id = rts.tenant_id
FROM public.roof_training_sessions rts
WHERE rts.vendor_report_id = rvr.id
  AND rvr.tenant_id IS NULL
  AND rts.tenant_id IS NOT NULL;

-- Deduplicate training sessions: keep earliest per (tenant_id, vendor_report_id)
DELETE FROM public.roof_training_sessions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY tenant_id, vendor_report_id ORDER BY created_at ASC) AS rn
    FROM public.roof_training_sessions
    WHERE vendor_report_id IS NOT NULL
  ) sub
  WHERE sub.rn > 1
);