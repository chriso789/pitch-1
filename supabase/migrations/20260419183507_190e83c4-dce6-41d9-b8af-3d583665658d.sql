ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS preferred_slot_1 timestamptz,
  ADD COLUMN IF NOT EXISTS preferred_slot_2 timestamptz,
  ADD COLUMN IF NOT EXISTS preferred_slot_3 timestamptz,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS confirmed_slot timestamptz,
  ADD COLUMN IF NOT EXISTS interview_status text DEFAULT 'pending';