ALTER TABLE public.photo_reference_candidates
  ADD COLUMN condition text,
  ADD COLUMN review_comment text,
  ADD CONSTRAINT prc_condition CHECK (condition IS NULL OR condition IN ('normal','possible_damage','maintenance','uncertain'));