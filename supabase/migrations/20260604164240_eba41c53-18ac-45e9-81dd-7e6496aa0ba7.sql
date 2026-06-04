-- Phase 7.5: harden enhanced_estimates.status + add approval object columns to handoff batches.

-- 1) enhanced_estimates.status hardening. Only values observed in prod: draft, sent, signed.
ALTER TABLE public.enhanced_estimates
  ADD CONSTRAINT enhanced_estimates_status_check
  CHECK (status IN ('draft', 'sent', 'signed'));

-- 2) blueprint_estimate_handoff_batches approval-object columns (nullable, additive).
ALTER TABLE public.blueprint_estimate_handoff_batches
  ADD COLUMN IF NOT EXISTS approval_object jsonb,
  ADD COLUMN IF NOT EXISTS approval_statement_version text,
  ADD COLUMN IF NOT EXISTS deterministic_approval_hash text,
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.blueprint_estimate_handoff_batches
  ADD CONSTRAINT blueprint_estimate_handoff_batches_approval_status_check
  CHECK (approval_status IS NULL OR approval_status IN (
    'approval_not_started',
    'approval_in_review',
    'approval_ready',
    'approved_for_live_handoff',
    'approval_revoked',
    'approval_superseded',
    'approval_failed'
  ));

NOTIFY pgrst, 'reload schema';