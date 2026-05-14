ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS phase3_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS phase3_engine_version text,
  ADD COLUMN IF NOT EXISTS "phase3A_eave_rake_classifier_version" text,
  ADD COLUMN IF NOT EXISTS "phase3B_roof_lines_persistence_version" text,
  ADD COLUMN IF NOT EXISTS "phase3C_deferred_edges_version" text,
  ADD COLUMN IF NOT EXISTS "phase3D_backbone_seed_version" text,
  ADD COLUMN IF NOT EXISTS "phase3E_constraint_repair_version" text,
  ADD COLUMN IF NOT EXISTS "phase3F_result_state_version" text,
  ADD COLUMN IF NOT EXISTS "phase3G_diagram_render_intent_version" text;

NOTIFY pgrst, 'reload schema';