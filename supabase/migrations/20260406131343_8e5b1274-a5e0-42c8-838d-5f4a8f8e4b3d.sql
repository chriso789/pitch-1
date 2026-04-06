ALTER TABLE public.training_pairs 
  ADD COLUMN IF NOT EXISTS footprint_mask jsonb,
  ADD COLUMN IF NOT EXISTS line_masks jsonb;