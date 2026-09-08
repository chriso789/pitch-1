ALTER TABLE public.domain_events ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

UPDATE public.domain_events SET dispatched_at = COALESCE(occurred_at, created_at, now()) WHERE dispatched_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_domain_events_undispatched ON public.domain_events (occurred_at) WHERE dispatched_at IS NULL;