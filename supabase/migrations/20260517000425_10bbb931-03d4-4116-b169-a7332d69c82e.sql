ALTER TABLE public.scope_comparison_lines
  ADD COLUMN IF NOT EXISTS grouped_children jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS match_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS match_score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS normalized_key text,
  ADD COLUMN IF NOT EXISTS canonical_group text;

CREATE INDEX IF NOT EXISTS idx_scope_comparison_lines_normalized_key
  ON public.scope_comparison_lines(normalized_key);

CREATE INDEX IF NOT EXISTS idx_scope_comparison_lines_grouped_children
  ON public.scope_comparison_lines USING gin(grouped_children);