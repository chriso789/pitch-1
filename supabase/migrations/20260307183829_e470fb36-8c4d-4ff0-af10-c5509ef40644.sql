
CREATE TABLE public.setup_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_setup_tokens_token ON public.setup_tokens(token);
CREATE INDEX idx_setup_tokens_user ON public.setup_tokens(user_id);

ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;
